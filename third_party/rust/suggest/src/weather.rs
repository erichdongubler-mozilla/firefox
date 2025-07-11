/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

use rusqlite::named_params;
use serde::Deserialize;
use sql_support::ConnExt;

use std::{cmp::Ordering, collections::HashSet};

use crate::{
    config::SuggestProviderConfig,
    db::{
        KeywordInsertStatement, KeywordsMetrics, KeywordsMetricsUpdater, SuggestDao,
        SuggestionInsertStatement, DEFAULT_SUGGESTION_SCORE,
    },
    geoname::GeonameMatch,
    metrics::MetricsContext,
    provider::SuggestionProvider,
    rs::{Client, Record, SuggestRecordId, SuggestRecordType},
    store::SuggestStoreInner,
    suggestion::Suggestion,
    util::filter_map_chunks,
    Result, SuggestionQuery,
};

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct DownloadedWeatherAttachment {
    /// Weather keywords.
    pub keywords: Vec<String>,
    /// Threshold for weather keyword prefix matching when a weather keyword is
    /// the first term in a query. `None` means prefix matching is disabled and
    /// weather keywords must be typed in full when they are first in the query.
    /// This threshold does not apply to city and region names. If there are
    /// multiple weather records, we use the `min_keyword_length` in the most
    /// recently ingested record.
    pub min_keyword_length: Option<i32>,
    /// Score for weather suggestions. If there are multiple weather records, we
    /// use the `score` from the most recently ingested record.
    pub score: Option<f64>,
}

/// This data is used to service every query handled by the weather provider, so
/// we cache it from the DB.
#[derive(Debug, Default)]
pub struct WeatherCache {
    /// Cached value of the same name from `SuggestProviderConfig::Weather`.
    min_keyword_length: usize,
    /// Cached value of the same name from `SuggestProviderConfig::Weather`.
    score: f64,
    /// Cached weather keywords metrics.
    keywords_metrics: KeywordsMetrics,
}

impl SuggestDao<'_> {
    /// Fetches weather suggestions.
    pub fn fetch_weather_suggestions(&self, query: &SuggestionQuery) -> Result<Vec<Suggestion>> {
        // We'll just stipulate we won't support tiny queries in order to avoid
        // a bunch of work when the user starts typing a query.
        if query.keyword.len() < 3 {
            return Ok(vec![]);
        }

        // The first step in parsing the query is splitting it into words. We
        // want to avoid that work for strings that are so long they can't
        // possibly match. We'll stipulate that weather queries will include the
        // following parts at most:
        //
        // * 3 geonames max: city + one admin division like a state + country
        // * 1 weather keyword
        // * 3 spaces between the previous geonames and keyword
        // * 10 extra chars to allow for extra spaces and punctuation
        //
        // This will exclude some valid queries because the logic below allows
        // for multiple weather keywords, and a city may have more than one
        // admin division, but we don't expect many users to type such long
        // queries.
        //
        // There's no point in an analogous min length check since weather
        // suggestions can be matched on city alone and many city names are only
        // a few characters long ("nyc").

        let g_cache = self.geoname_cache();
        let w_cache = self.weather_cache();
        let max_query_len =
            3 * g_cache.keywords_metrics.max_len + w_cache.keywords_metrics.max_len + 10;
        if max_query_len < query.keyword.len() {
            return Ok(vec![]);
        }

        let max_chunk_size = std::cmp::max(
            g_cache.keywords_metrics.max_word_count,
            w_cache.keywords_metrics.max_word_count,
        );

        // Split the query on whitespace and commas too so that queries like
        // "city region" and "city, region" both become ["city", "region"].
        let words: Vec<_> = query
            .keyword
            .split(|c| char::is_whitespace(c) || c == ',')
            .filter(|s| !s.is_empty())
            .collect();

        // Step 2: Parse the query words into a list of token paths.
        let raw_token_paths =
            filter_map_chunks::<Token>(&words, max_chunk_size, |chunk, chunk_i, is_last, path| {
                // Find all token types that match the chunk.
                let mut all_tokens: Option<Vec<Token>> = None;
                for tt in [TokenType::Geoname, TokenType::WeatherKeyword] {
                    let mut tokens =
                        self.match_weather_tokens(tt, path, chunk, chunk_i == 0, is_last)?;
                    if !tokens.is_empty() {
                        let mut ts = all_tokens.take().unwrap_or_default();
                        ts.append(&mut tokens);
                        all_tokens.replace(ts);
                    }
                }
                // If no tokens were matched, `all_tokens` will be `None`.
                Ok(all_tokens)
            })?;

        // Step 3: Map each valid token path to a `TokenPath` and discard
        // invalid paths. Save the paths that include cities. For paths that
        // include keywords alone, only keep track of the minimum keyword count
        // across all paths. e.g., if one path has one keyword alone and another
        // path has two keywords alone, set `kws_alone_min_count` to 1.
        let mut kws_alone_min_count: Option<usize> = None;
        let mut city_token_paths: Vec<_> = raw_token_paths
            .into_iter()
            .filter_map(|rtp| {
                TokenPath::from_raw_token_path(rtp).and_then(|tp| match tp {
                    TokenPath::City(ctp) => Some(ctp),
                    TokenPath::WeatherKeywordsAlone(count) => {
                        kws_alone_min_count = kws_alone_min_count
                            .map(|min_count| std::cmp::min(min_count, count))
                            .or(Some(count));
                        None
                    }
                })
            })
            .collect();

        // Step 4: If any token path is one keyword alone, return a suggestion
        // without a city even if there are other token paths with cities. In
        // other words, greedily match on a single keyword. As a simplified
        // example, if "rain" and "rain in" are keywords and the query is "rain
        // in", there will be two token paths:
        //
        // 1. "rain in" keyword alone
        // 2. "rain" keyword + Indianapolis city match (for example)
        //
        // We want to return a suggestion only for the first path, "rain in".
        if kws_alone_min_count == Some(1) {
            return Ok(vec![Suggestion::Weather {
                city: None,
                score: w_cache.score,
            }]);
        }

        // Step 5: Sort city token paths, first by city match length descending
        // and then by other geoname match length descending. The idea is that
        // the more of a name the user matched, the better the match. If two
        // paths are still equal, break the tie by population descending.
        city_token_paths.sort_by(|ctp1, ctp2| {
            let city_cmp = ctp2.city_match_len.cmp(&ctp1.city_match_len);
            if city_cmp != Ordering::Equal {
                city_cmp
            } else {
                let other_cmp = ctp2
                    .other_geoname_match_len
                    .cmp(&ctp1.other_geoname_match_len);
                if other_cmp != Ordering::Equal {
                    other_cmp
                } else {
                    ctp2.city_match
                        .geoname
                        .population
                        .cmp(&ctp1.city_match.geoname.population)
                }
            }
        });

        // Step 6: If there are any city token paths, return suggestions for
        // them.
        //
        // The cities with the max match lengths are now at the front of the
        // list. There may be multiple matches with the max match lengths, and
        // the same city may be represented multiple times since it may have
        // been matched in different paths.
        //
        // Take all the matches with the same (max) match lengths at the front
        // of the list and create a `Suggestion` for each unique city.
        if let Some(first_ctp) = city_token_paths.first() {
            let mut geoname_ids = HashSet::new();
            let (max_city_match_len, max_other_geoname_match_len) =
                (first_ctp.city_match_len, first_ctp.other_geoname_match_len);
            return Ok(city_token_paths
                .into_iter()
                .take_while(|ctp| {
                    ctp.city_match_len == max_city_match_len
                        && ctp.other_geoname_match_len == max_other_geoname_match_len
                })
                .filter_map(|ctp| {
                    if geoname_ids.contains(&ctp.city_match.geoname.geoname_id) {
                        None
                    } else {
                        geoname_ids.insert(ctp.city_match.geoname.geoname_id);
                        Some(Suggestion::Weather {
                            city: Some(ctp.city_match.geoname),
                            score: w_cache.score,
                        })
                    }
                })
                .collect());
        }

        // Step 7: If there are any paths with multiple keywords, return a
        // single suggestion without a city.
        if kws_alone_min_count.is_some() {
            return Ok(vec![Suggestion::Weather {
                city: None,
                score: w_cache.score,
            }]);
        }

        Ok(Vec::new())
    }

    fn match_weather_tokens(
        &self,
        token_type: TokenType,
        path: &[Token],
        candidate: &str,
        is_first_chunk: bool,
        is_last_chunk: bool,
    ) -> Result<Vec<Token>> {
        match token_type {
            TokenType::Geoname => {
                // Fetch matching geonames, and filter them to geonames we've
                // already matched in this path.
                let geonames_in_path: Vec<_> = path
                    .iter()
                    .filter_map(|t| t.geoname_match().map(|gm| &gm.geoname))
                    .collect();
                Ok(self
                    .fetch_geonames(
                        candidate,
                        is_last_chunk,
                        if geonames_in_path.is_empty() {
                            None
                        } else {
                            Some(geonames_in_path)
                        },
                    )?
                    .into_iter()
                    .map(|geoname_match| Token::Geoname {
                        geoname_match,
                        match_len: candidate.len(),
                    })
                    .collect())
            }
            TokenType::WeatherKeyword => {
                // See if the candidate matches a keyword. `min_keyword_length`
                // in the config controls matching when a query contains only a
                // keyword or keyword prefix: Zero means prefix matching is not
                // allowed and keywords must be typed in full; non-zero means
                // the candidate must be at least that long, even if it's a full
                // keyword.
                //
                // Prefix matching is always allowed when the query contains
                // other terms and the keyword prefix is the last term.
                let min_len = self.weather_cache().min_keyword_length;
                if is_first_chunk && is_last_chunk && candidate.len() < min_len {
                    // `min_keyword_length` is non-zero, the candidate is the
                    // only term in the query, and it's too short.
                    Ok(vec![])
                } else {
                    Ok(self
                        .match_weather_keywords(
                            candidate,
                            is_last_chunk && (!is_first_chunk || min_len > 0),
                        )?
                        .into_iter()
                        .map(Token::WeatherKeyword)
                        .collect())
                }
            }
        }
    }

    fn match_weather_keywords(
        &self,
        candidate: &str,
        prefix: bool,
    ) -> Result<Vec<WeatherKeywordMatch>> {
        self.conn.query_rows_and_then_cached(
            r#"
            SELECT
                k.keyword != :keyword AS matched_prefix
            FROM
                suggestions s
            JOIN
                keywords_i18n k
                ON k.suggestion_id = s.id
            WHERE
                s.provider = :provider
                AND (
                    k.keyword = :keyword
                    OR (:prefix AND (k.keyword BETWEEN :keyword AND :keyword || X'FFFF'))
                )
            "#,
            named_params! {
                ":prefix": prefix,
                ":keyword": candidate,
                ":provider": SuggestionProvider::Weather
            },
            |row| -> Result<WeatherKeywordMatch> {
                Ok(WeatherKeywordMatch {
                    is_prefix: row.get("matched_prefix")?,
                })
            },
        )
    }

    /// Inserts weather suggestions data into the database.
    fn insert_weather_data(
        &mut self,
        record_id: &SuggestRecordId,
        attachments: &[DownloadedWeatherAttachment],
    ) -> Result<()> {
        self.scope.err_if_interrupted()?;
        let mut suggestion_insert = SuggestionInsertStatement::new(self.conn)?;
        let mut keyword_insert =
            KeywordInsertStatement::with_details(self.conn, "keywords_i18n", None)?;
        let mut metrics_updater = KeywordsMetricsUpdater::new();

        for attach in attachments {
            let suggestion_id = suggestion_insert.execute(
                record_id,
                "",
                "",
                attach.score.unwrap_or(DEFAULT_SUGGESTION_SCORE),
                SuggestionProvider::Weather,
            )?;
            for (i, keyword) in attach.keywords.iter().enumerate() {
                keyword_insert.execute(suggestion_id, keyword, None, i)?;
                metrics_updater.update(keyword);
            }
            self.put_provider_config(SuggestionProvider::Weather, &attach.into())?;
        }

        metrics_updater.finish(
            self.conn,
            record_id,
            SuggestRecordType::Weather,
            &mut self.weather_cache,
        )?;

        Ok(())
    }

    fn weather_cache(&self) -> &WeatherCache {
        self.weather_cache.get_or_init(|| {
            let mut cache = WeatherCache {
                keywords_metrics: self
                    .get_keywords_metrics(SuggestRecordType::Weather)
                    .unwrap_or_default(),
                ..WeatherCache::default()
            };

            // provider config
            if let Ok(Some(SuggestProviderConfig::Weather {
                score,
                min_keyword_length,
            })) = self.get_provider_config(SuggestionProvider::Weather)
            {
                cache.min_keyword_length = usize::try_from(min_keyword_length).unwrap_or_default();
                cache.score = score;
            }

            cache
        })
    }
}

impl<S> SuggestStoreInner<S>
where
    S: Client,
{
    /// Inserts a weather record into the database.
    pub fn process_weather_record(
        &self,
        dao: &mut SuggestDao,
        record: &Record,
        context: &mut MetricsContext,
    ) -> Result<()> {
        self.download_attachment(dao, record, context, |dao, record_id, data| {
            dao.insert_weather_data(record_id, data)
        })
    }
}

impl From<&DownloadedWeatherAttachment> for SuggestProviderConfig {
    fn from(a: &DownloadedWeatherAttachment) -> Self {
        Self::Weather {
            score: a.score.unwrap_or(DEFAULT_SUGGESTION_SCORE),
            min_keyword_length: a.min_keyword_length.unwrap_or(0),
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum TokenType {
    Geoname,
    WeatherKeyword,
}

#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)]
enum Token {
    Geoname {
        geoname_match: GeonameMatch,
        match_len: usize,
    },
    WeatherKeyword(WeatherKeywordMatch),
}

impl Token {
    fn geoname_match(&self) -> Option<&GeonameMatch> {
        match self {
            Self::Geoname { geoname_match, .. } => Some(geoname_match),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
struct WeatherKeywordMatch {
    is_prefix: bool,
}

#[allow(clippy::large_enum_variant)]
enum TokenPath {
    City(CityTokenPath),
    // The `usize` is the number of keywords matched in the path.
    WeatherKeywordsAlone(usize),
}

struct CityTokenPath {
    city_match: GeonameMatch,
    city_match_len: usize,
    other_geoname_match_len: usize,
}

impl TokenPath {
    fn from_raw_token_path(rtp: Vec<Token>) -> Option<Self> {
        let mut kw_match_count = 0;
        let mut any_kw_match_full = false;
        let mut city_match: Option<GeonameMatch> = None;
        let mut city_match_len = 0;
        let mut any_other_geoname_full = false;
        let mut max_other_geoname_match_len = 0;

        for t in rtp {
            match t {
                Token::WeatherKeyword(kwm) => {
                    kw_match_count += 1;
                    any_kw_match_full = any_kw_match_full || !kwm.is_prefix;
                }
                Token::Geoname {
                    geoname_match,
                    match_len,
                } => {
                    if geoname_match.geoname.geoname_type == crate::geoname::GeonameType::City {
                        if city_match.is_some() {
                            // We already matched a city, so the path includes
                            // more than one, which is invalid.
                            return None;
                        }
                        city_match = Some(geoname_match);
                        city_match_len = match_len;
                    } else {
                        any_other_geoname_full = any_other_geoname_full || !geoname_match.prefix;
                        max_other_geoname_match_len =
                            std::cmp::max(max_other_geoname_match_len, match_len)
                    }
                }
            }
        }

        if let Some(cm) = city_match {
            // This path matched a city. See if it has a valid combination of
            // tokens. Keep a few things in mind:
            //
            // (1) The query contains a city name of some sort: a proper name,
            //     abbreviation, or airport code
            // (2) It may be a name prefix and not a full name
            // (3) Prefix matching happens only at the end of the query string
            let is_valid =
                // The query has full weather keyword(s):
                //
                // weather l
                // weather la
                // weather lo
                // weather los angeles
                // weather pdx
                // la weather
                // los angeles weather
                // pdx weather
                (kw_match_count > 0 && any_kw_match_full)
                    // The query has weather keyword(s) (full or prefix) + a
                    // full city abbreviation:
                    //
                    // la w
                    // la we
                    // la weather
                    // la ca w
                    // weather la
                    // weather la c
                    // weather la ca
                    || (kw_match_count > 0 && !cm.prefix && cm.match_type.is_abbreviation())
                    // The query has a full city proper name:
                    //
                    // los angeles
                    // los angeles c
                    // los angeles ca
                    // ca los angeles
                    // los angeles w
                    // los angeles we
                    // los angeles weather
                    // los angeles ca w
                    // weather los angeles
                    // weather los angeles c
                    // weather los angeles ca
                    || (!cm.prefix && cm.match_type.is_name())
                    // The query has a full city abbreviation + a full related
                    // geoname:
                    //
                    // la ca
                    // la california
                    // ca la
                    // california la
                    || (!cm.prefix
                        && cm.match_type.is_abbreviation()
                        && any_other_geoname_full);
            if is_valid {
                return Some(Self::City(CityTokenPath {
                    city_match: cm,
                    city_match_len,
                    other_geoname_match_len: max_other_geoname_match_len,
                }));
            }
        } else if kw_match_count > 0 && max_other_geoname_match_len == 0 {
            // This path matched weather keyword(s) alone.
            return Some(Self::WeatherKeywordsAlone(kw_match_count));
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        geoname, geoname::Geoname, store::tests::TestStore, testing::*, SuggestIngestionConstraints,
    };

    impl From<Geoname> for Suggestion {
        fn from(g: Geoname) -> Self {
            Suggestion::Weather {
                city: Some(g),
                score: 0.24,
            }
        }
    }

    #[test]
    fn weather_provider_config() -> anyhow::Result<()> {
        before_each();
        let store = TestStore::new(MockRemoteSettingsClient::default().with_record(
            SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    "min_keyword_length": 3,
                    "keywords": ["ab", "xyz", "weather"],
                    "score": 0.24
                }),
            ),
        ));
        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });
        assert_eq!(
            store.fetch_provider_config(SuggestionProvider::Weather),
            Some(SuggestProviderConfig::Weather {
                score: 0.24,
                min_keyword_length: 3,
            })
        );
        Ok(())
    }

    #[test]
    fn weather_keywords_prefixes_allowed() -> anyhow::Result<()> {
        before_each();

        let store = TestStore::new(MockRemoteSettingsClient::default().with_record(
            SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    // min_keyword_length > 0 means prefixes are allowed.
                    "min_keyword_length": 5,
                    "keywords": ["ab", "xyz", "cdefg", "weather"],
                    "score": 0.24
                }),
            ),
        ));

        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        let no_matches = [
            // doesn't match any keyword
            "ab123",
            "123ab",
            "xyz12",
            "12xyz",
            "xcdefg",
            "cdefgx",
            "x cdefg",
            "weatherx",
            "xweather",
            "xweat",
            "weatx",
            "x   weather",
            "weather foo",
            "foo weather",
            // too short
            "ab",
            "xyz",
            "cdef",
            "we",
            "wea",
            "weat",
        ];
        for q in no_matches {
            assert_eq!(store.fetch_suggestions(SuggestionQuery::weather(q)), vec![]);
        }

        let matches = [
            "cdefg",
            // full keyword ("cdefg") + prefix of another keyword ("xyz")
            "cdefg x",
            "weath",
            "weathe",
            "weather",
            "WeAtHeR",
            "  weather  ",
            // full keyword ("weather") + prefix of another keyword ("xyz")
            "   weather x",
        ];
        for q in matches {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather(q)),
                vec![Suggestion::Weather {
                    score: 0.24,
                    city: None,
                }]
            );
        }

        Ok(())
    }

    #[test]
    fn weather_keywords_prefixes_not_allowed() -> anyhow::Result<()> {
        before_each();

        let store = TestStore::new(MockRemoteSettingsClient::default().with_record(
            SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    // min_keyword_length == 0 means prefixes are not allowed.
                    "min_keyword_length": 0,
                    "keywords": ["weather"],
                    "score": 0.24
                }),
            ),
        ));

        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        let no_matches = ["wea", "weat", "weath", "weathe"];
        for q in no_matches {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather(q)),
                vec![],
                "query: {:?}",
                q
            );
        }

        let matches = ["weather", "WeAtHeR", "  weather  "];
        for q in matches {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather(q)),
                vec![Suggestion::Weather {
                    score: 0.24,
                    city: None,
                }],
                "query: {:?}",
                q
            );
        }

        Ok(())
    }

    #[test]
    fn weather_keywords_collate() -> anyhow::Result<()> {
        before_each();

        let store = TestStore::new(MockRemoteSettingsClient::default().with_record(
            SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    "min_keyword_length": 0,
                    "keywords": [
                        "AbC xYz",
                        "Àęí",
                        // "wéather" with single 'é' char
                        "w\u{00e9}ather",
                        // "éfg" with ASCII 'e' followed by combining acute
                        // accent
                        "e\u{0301}fg",
                        "größe",
                        "abc. def-ghi",
                        "x.y.z.",
                    ],
                    "score": 0.24
                }),
            ),
        ));

        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        let matches = [
            "AbC xYz",
            "ABC XYZ",
            "abc xyz",
            "Àęí",
            "Aei",
            "àęí",
            "aei",
            // "wéather" with single 'é' char
            "w\u{00e9}ather",
            // "wéather" with ASCII 'e' followed by combining acute
            // accent
            "we\u{0301}ather",
            "weather",
            // "éfg" with single 'é' char
            "\u{00e9}fg",
            // "éfg" with ASCII 'e' followed by combining acute
            // accent
            "e\u{0301}fg",
            "efg",
            "größe",
            "große",
            "grösse",
            "grosse",
            "abc. def-ghi",
            "abc def-ghi",
            "abc. def ghi",
            "abc def ghi",
            "x.y.z.",
            "xy.z.",
            "x.yz.",
            "x.y.z",
            "xyz.",
            "xy.z",
            "x.yz",
            "xyz",
        ];

        for q in matches {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather(q)),
                vec![Suggestion::Weather {
                    score: 0.24,
                    city: None,
                }],
                "query: {:?}",
                q
            );
        }

        Ok(())
    }

    #[test]
    fn weather_keyword_includes_city_prefix() -> anyhow::Result<()> {
        before_each();

        let kws = [
            "weather",
            "weather ",
            // These keywords start with the "weather" keyword and end in
            // prefixes of "new york"
            "weather n",
            "weather ne",
            "weather new",
            // These keywords are prefixes of "new york"
            "new",
            "new ",
            "new y",
            "new yo",
        ];

        let mut store = geoname::tests::new_test_store();
        store
            .client_mut()
            .add_record(SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    "min_keyword_length": 0,
                    "keywords": kws,
                    "score": 0.24
                }),
            ));

        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        // Make sure "new york" really matches a city.
        assert_eq!(
            store.fetch_suggestions(SuggestionQuery::weather("new york")),
            vec![Suggestion::Weather {
                score: 0.24,
                city: Some(geoname::tests::nyc()),
            }],
        );

        // Queries for each of the keywords alone should match a suggestion
        // without a city, even though for example "weather new" also matches
        // the "weather" keyword and a prefix of "new york".
        for q in kws {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather(q)),
                vec![Suggestion::Weather {
                    score: 0.24,
                    city: None,
                }],
                "Keyword alone query: {:?}",
                q
            );
        }

        // These queries match both the "weather" keyword and a city but are not
        // also keywords themselves, so their suggestions should include the
        // city.
        let city_matches = [
            "weather new y",
            "weather new yo",
            "weather new yor",
            "weather new york",
        ];
        for q in city_matches {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather(q)),
                vec![Suggestion::Weather {
                    score: 0.24,
                    city: Some(geoname::tests::nyc()),
                }],
                "City query: {:?}",
                q
            );
        }

        Ok(())
    }

    #[test]
    fn weather_keyword_same_as_city() -> anyhow::Result<()> {
        before_each();

        let mut store = geoname::tests::new_test_store();
        store
            .client_mut()
            .add_record(SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    "min_keyword_length": 0,
                    "keywords": [],
                    "score": 0.24
                }),
            ));
        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        // Make sure "new york" really matches a city.
        for q in ["new york", "new york city"] {
            assert_eq!(
                store.fetch_suggestions(SuggestionQuery::weather("new york")),
                vec![Suggestion::Weather {
                    score: 0.24,
                    city: Some(geoname::tests::nyc()),
                }],
                "new york query: {:?}",
                q
            );
        }

        store
            .client_mut()
            .update_record(SuggestionProvider::Weather.record(
                "weather-1",
                json!({
                    "min_keyword_length": 0,
                    "keywords": ["new york"],
                    "score": 0.24
                }),
            ));
        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        assert_eq!(
            store.fetch_suggestions(SuggestionQuery::weather("new york")),
            vec![Suggestion::Weather {
                score: 0.24,
                city: None,
            }],
        );

        assert_eq!(
            store.fetch_suggestions(SuggestionQuery::weather("new york city")),
            vec![Suggestion::Weather {
                score: 0.24,
                city: Some(geoname::tests::nyc()),
            }],
        );

        Ok(())
    }

    #[test]
    fn cities_and_regions() -> anyhow::Result<()> {
        before_each();

        let record_json = json!({
            "keywords": [
                "ab",
                "xyz",
                // "weather" is a prefix of "weather near me" -- when a
                // test matches both one suggestion should be returned
                "weather",
                "weather near me",
                // These are suffixes of two place names that both start
                // with "New"
                "york",
                "orleans",
                // This is an admin division name
                "iowa",
            ],
            "score": 0.24
        });

        // Each test is run twice, once with a weather record where
        // `min_keyword_length` is 0 and once where it's 5.
        struct Test<'a> {
            query: &'a str,
            // expected suggestions per `min_keyword_length`
            min_keyword_len_0: Vec<Suggestion>,
            min_keyword_len_5: Vec<Suggestion>,
        }

        const KW_SUGGESTION: Suggestion = Suggestion::Weather {
            score: 0.24,
            city: None,
        };

        let tests: &[Test] = &[
            // "act" is Waco's airport code. Airport codes require full weather
            // keywords to match.
            Test {
                query: "act",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act we",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act wea",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act weat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act weath",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act weather",
                min_keyword_len_0: vec![geoname::tests::waco().into()],
                min_keyword_len_5: vec![geoname::tests::waco().into()],
            },

            Test {
                // A suggestion without a city should be returned because this
                // query matches a full keyword ("weather") + a prefix of
                // another keyword ("ab").
                query: "weather a",
                min_keyword_len_0: vec![KW_SUGGESTION.clone()],
                min_keyword_len_5: vec![KW_SUGGESTION.clone()],
            },
            Test {
                query: "weather ac",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather act",
                min_keyword_len_0: vec![geoname::tests::waco().into()],
                min_keyword_len_5: vec![geoname::tests::waco().into()],
            },
            Test {
                query: "act t",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act tx",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act tx w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act tx weat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act tx weath",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act tx weather",
                min_keyword_len_0: vec![geoname::tests::waco().into()],
                min_keyword_len_5: vec![geoname::tests::waco().into()],
            },
            Test {
                query: "tx a",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "tx ac",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "tx act",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "tx act w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "tx act weat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "tx act weath",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "tx act weather",
                min_keyword_len_0: vec![geoname::tests::waco().into()],
                min_keyword_len_5: vec![geoname::tests::waco().into()],
            },
            Test {
                query: "act te",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act tex",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act texa",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act texas",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act texas w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act texas weat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act texas weath",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "act texas weather",
                min_keyword_len_0: vec![geoname::tests::waco().into()],
                min_keyword_len_5: vec![geoname::tests::waco().into()],
            },
            Test {
                query: "texas a",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "texas ac",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "texas act",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "texas act w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "texas act weat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "texas act weath",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "texas act weather",
                min_keyword_len_0: vec![geoname::tests::waco().into()],
                min_keyword_len_5: vec![geoname::tests::waco().into()],
            },

            Test {
                query: "ia w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia wa",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia wat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia wate",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia water",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia waterl",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia waterlo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia waterloo",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },

            Test {
                query: "w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "wa",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "wat",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "wate",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "water",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "waterl",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "waterlo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "waterloo",
                // Matches should be returned by population descending.
                min_keyword_len_0: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
                min_keyword_len_5: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
            },

            Test {
                query: "i",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ia",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "io",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "iow",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                // "iowa" is a also weather keyword.
                query: "iowa",
                min_keyword_len_0: vec![KW_SUGGESTION.clone()],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "waterloo al",
                min_keyword_len_0: vec![geoname::tests::waterloo_al().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_al().into()],
            },
            Test {
                query: "al waterloo",
                min_keyword_len_0: vec![geoname::tests::waterloo_al().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_al().into()],
            },

            Test {
                query: "waterloo ia al",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "waterloo ny",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "al",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "alabama",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "new york",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york new york",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny ny ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: "ny n",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ny ne",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ny new",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ny new ",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            // These shouldn't match anything. "ny" is an NYC abbreviation, and
            // without a weather keyword, abbreviations require another fully
            // typed related geoname. "york" is also a weather keyword but that
            // shouldn't matter here since "new" by itself is not a full name.
            Test {
                query: "ny new y",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ny new yo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ny new yor",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "ny new york",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: "weather ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            // "ny" is an NYC abbreviation. A suggestion should be returned once
            // the query ends with any prefix of "weather" (a keyword).
            Test {
                query: "ny w",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny weat",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny weath",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: "weather ny ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny weather ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny ny weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: "rochester ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "ny rochester",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester weather ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester ny weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather ny rochester",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "ny weather rochester",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "ny rochester weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },

            Test {
                query: "weather new york",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new weather york",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "new york weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new york new york",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york weather new york",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york new york weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: "weather water",
                min_keyword_len_0: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
                min_keyword_len_5: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
            },
            Test {
                query: "waterloo w",
                min_keyword_len_0: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
                min_keyword_len_5: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
            },
            Test {
                query: "weather w w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather w water",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather w waterloo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather water w",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather waterloo water",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather water water",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather water waterloo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "waterloo foo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "waterloo weather foo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "foo waterloo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "foo waterloo weather",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather waterloo foo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather foo waterloo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather water foo",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "weather foo water",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "waterloo on",
                min_keyword_len_0: vec![geoname::tests::waterloo_on().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_on().into()],
            },
            Test {
                query: "waterloo ont",
                min_keyword_len_0: vec![geoname::tests::waterloo_on().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_on().into()],
            },
            Test {
                query: "waterloo ont.",
                min_keyword_len_0: vec![geoname::tests::waterloo_on().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_on().into()],
            },
            Test {
                query: "waterloo ontario",
                min_keyword_len_0: vec![geoname::tests::waterloo_on().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_on().into()],
            },
            Test {
                query: "waterloo canada",
                min_keyword_len_0: vec![geoname::tests::waterloo_on().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_on().into()],
            },
            Test {
                query: "waterloo on canada",
                min_keyword_len_0: vec![geoname::tests::waterloo_on().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_on().into()],
            },

            Test {
                query: "waterloo on us",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "waterloo al canada",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "ny",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "nyc",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "roc",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "roc ny",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "ny roc",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "nyc ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "ny nyc",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "nyc weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather nyc",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "roc weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather roc",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },

            Test {
                // full "weather" keyword + name prefix
                query: "weather new",
                min_keyword_len_0: vec![
                    geoname::tests::nyc().into(),
                    geoname::tests::new_orleans().into(),
                ],
                min_keyword_len_5: vec![
                    geoname::tests::nyc().into(),
                    geoname::tests::new_orleans().into(),
                ],
            },
            Test {
                // full "weather" keyword + name prefix + "xyz" keyword prefix,
                // invalid
                query: "weather new xy",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                // full "weather" keyword + name prefix + "weather" keyword
                // prefix, invalid
                query: "weather new we",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            // These should match New York even though there's also a weather
            // keyword called "york".
            Test {
                query: "weather new y",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new yo",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new yor",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            // These should match New Orleans even though there's also a weather
            // keyword "orleans".
            Test {
                query: "weather new o",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },
            Test {
                query: "weather new or",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },
            Test {
                query: "weather new orl",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },
            Test {
                query: "weather new orle",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },
            Test {
                query: "weather new orlea",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },
            Test {
                query: "weather new orlean",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },
            Test {
                query: "weather new orleans",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },

            Test {
                query: "new o",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "new orlean",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "new orleans",
                min_keyword_len_0: vec![geoname::tests::new_orleans().into()],
                min_keyword_len_5: vec![geoname::tests::new_orleans().into()],
            },

            // Query with a weather keyword that's also an admin division name:
            // This should match only Waterloo, IA even though "iowa" is also a
            // weather keyword.
            Test {
                query: "weather waterloo iowa",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },

            Test {
                query: "weather san diego",
                min_keyword_len_0: vec![geoname::tests::san_diego().into()],
                min_keyword_len_5: vec![geoname::tests::san_diego().into()],
            },

            // This should match "san diego" (the city) and "ca" (the state). It
            // should not match Carlsbad, CA even though Carlsbad starts with
            // "ca" and it's in San Diego County.
            Test {
                query: "weather san diego ca",
                min_keyword_len_0: vec![geoname::tests::san_diego().into()],
                min_keyword_len_5: vec![geoname::tests::san_diego().into()],
            },

            // These should match Carlsbad since it's in San Diego County.
            Test {
                query: "weather san diego car",
                min_keyword_len_0: vec![geoname::tests::carlsbad().into()],
                min_keyword_len_5: vec![geoname::tests::carlsbad().into()],
            },
            Test {
                query: "weather san diego carlsbad",
                min_keyword_len_0: vec![geoname::tests::carlsbad().into()],
                min_keyword_len_5: vec![geoname::tests::carlsbad().into()],
            },

            // In these next two, "san" is a prefix of San Diego, and "ca" is
            // both a prefix of Carlsbad and a California abbreviation.
            Test {
                // "san ca" is not a city or city prefix, and "san" is not the
                // last term in the query, so this shouldn't match anything.
                query: "weather san ca",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                // "ca" is a full abbreviation for California, and "san" should
                // prefix match on San Diego since it's the last term in the
                // query. San Diego is in California, so it should be returned.
                query: "weather ca san",
                min_keyword_len_0: vec![geoname::tests::san_diego().into()],
                min_keyword_len_5: vec![geoname::tests::san_diego().into()],
            },

            // "san carl" isn't a prefix of any city, and "san" should not match
            // San Diego County since it's not at the end of the query.
            Test {
                query: "weather san carl",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: "san carl",
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },

            Test {
                query: "liverpool",
                min_keyword_len_0: vec![geoname::tests::liverpool_city().into()],
                min_keyword_len_5: vec![geoname::tests::liverpool_city().into()],
            },
            Test {
                query: "liverpool",
                min_keyword_len_0: vec![geoname::tests::liverpool_city().into()],
                min_keyword_len_5: vec![geoname::tests::liverpool_city().into()],
            },
            Test {
                query: "liverpool eng",
                min_keyword_len_0: vec![geoname::tests::liverpool_city().into()],
                min_keyword_len_5: vec![geoname::tests::liverpool_city().into()],
            },
            Test {
                query: "liverpool england",
                min_keyword_len_0: vec![geoname::tests::liverpool_city().into()],
                min_keyword_len_5: vec![geoname::tests::liverpool_city().into()],
            },
            Test {
                query: "liverpool uk",
                min_keyword_len_0: vec![geoname::tests::liverpool_city().into()],
                min_keyword_len_5: vec![geoname::tests::liverpool_city().into()],
            },
            Test {
                query: "liverpool england uk",
                min_keyword_len_0: vec![geoname::tests::liverpool_city().into()],
                min_keyword_len_5: vec![geoname::tests::liverpool_city().into()],
            },

            Test {
                query: "La Visitation-de-l'Île-Dupas",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "la visitation-de-l'île-dupas",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "la visitation-de-l'île-dupas wea",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "la visitation-de-l'île-dupas weather",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "weather la visitation-de-l'île-dupas",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "weather la v",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "weather la visitation",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "weather la visitation de",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "la visitation de lile dupas",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "la visitation de lile dupas wea",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "la visitation de lile dupas weather",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },
            Test {
                query: "weather la visitation de lile dupas",
                min_keyword_len_0: vec![geoname::tests::la_visitation().into()],
                min_keyword_len_5: vec![geoname::tests::la_visitation().into()],
            },

            Test {
                query: geoname::tests::LONG_NAME,
                min_keyword_len_0: vec![geoname::tests::long_name_city().into()],
                min_keyword_len_5: vec![geoname::tests::long_name_city().into()],
            },

            Test {
                query: "     waterloo iowa",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },
            Test {
                query: "     waterloo ia",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },

            Test {
                query: "waterloo     ia",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },
            Test {
                query: "waterloo ia     ",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },
            Test {
                query: "  waterloo   ia    ",
                min_keyword_len_0: vec![geoname::tests::waterloo_ia().into()],
                min_keyword_len_5: vec![geoname::tests::waterloo_ia().into()],
            },
            Test {
                query: "   WaTeRlOo   ",
                min_keyword_len_0: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
                min_keyword_len_5: vec![
                    geoname::tests::waterloo_on().into(),
                    geoname::tests::waterloo_ia().into(),
                    geoname::tests::waterloo_al().into(),
                ],
            },

            Test {
                query: "     new york weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new     york weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york     weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york weather     ",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: "rochester",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester ,",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester , ",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester,ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester, ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester ,ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester , ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester,",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester, ",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester , ",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester,ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester, ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester ,ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "weather rochester , ny",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester,weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester, weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester ,weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester , weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester,ny weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester, ny weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester ,ny weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },
            Test {
                query: "rochester , ny weather",
                min_keyword_len_0: vec![geoname::tests::rochester().into()],
                min_keyword_len_5: vec![geoname::tests::rochester().into()],
            },

            Test {
                query: "new york,",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york ,",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york , ",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york,ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york, ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york ,ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york , ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new york,ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new york, ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new york ,ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "weather new york , ny",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york,weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york, weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york ,weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york , weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york,ny weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york, ny weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york ,ny weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },
            Test {
                query: "new york , ny weather",
                min_keyword_len_0: vec![geoname::tests::nyc().into()],
                min_keyword_len_5: vec![geoname::tests::nyc().into()],
            },

            Test {
                query: &format!("{} weather", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![geoname::tests::long_name_city().into()],
                min_keyword_len_5: vec![geoname::tests::long_name_city().into()],
            },
            Test {
                query: &format!("weather {}", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![geoname::tests::long_name_city().into()],
                min_keyword_len_5: vec![geoname::tests::long_name_city().into()],
            },

            Test {
                query: &format!("{} and some other words that don't match anything but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("and some other words that don't match anything {} but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("and some other words that don't match anything but that is neither here nor there {}", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("weather {} and some other words that don't match anything but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("{} weather and some other words that don't match anything but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("{} and some other words that don't match anything weather but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("{} and some other words that don't match anything but that is neither here nor there weather", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("weather and some other words that don't match anything {} but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("weather and some other words that don't match anything but that is neither here nor there {}", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("and some other words that don't match anything weather {} but that is neither here nor there", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("and some other words that don't match anything but that is neither here nor there weather {}", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("{} weather and then this also doesn't match anything down here", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("{} and then this also doesn't match anything down here weather", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("and then this also doesn't match anything down here {} weather", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
            Test {
                query: &format!("and then this also doesn't match anything down here weather {}", geoname::tests::LONG_NAME),
                min_keyword_len_0: vec![],
                min_keyword_len_5: vec![],
            },
        ];

        for min_keyword_length in [0, 5] {
            let mut store = geoname::tests::new_test_store();
            store
                .client_mut()
                .add_record(SuggestionProvider::Weather.record(
                    "weather-1",
                    record_json.clone().merge(json!({
                        "min_keyword_length": min_keyword_length,
                    })),
                ));

            store.ingest(SuggestIngestionConstraints {
                providers: Some(vec![SuggestionProvider::Weather]),
                ..SuggestIngestionConstraints::all_providers()
            });

            for test in tests {
                assert_eq!(
                    &store.fetch_suggestions(SuggestionQuery::weather(test.query)),
                    match min_keyword_length {
                        0 => &test.min_keyword_len_0,
                        5 => &test.min_keyword_len_5,
                        _ => std::unreachable!(),
                    },
                    "Query: {:?}, min_keyword_length={}",
                    test.query,
                    min_keyword_length
                );
            }
        }

        Ok(())
    }

    #[test]
    fn keywords_metrics() -> anyhow::Result<()> {
        before_each();

        // Add a couple of records with different metrics. We're just testing
        // metrics so the other values don't matter.
        let mut store = TestStore::new(
            MockRemoteSettingsClient::default()
                .with_record(SuggestionProvider::Weather.record(
                    "weather-0",
                    json!({
                        "min_keyword_length": 3,
                        "score": 0.24,
                        "keywords": [
                            "a b c d ef"
                        ],
                    }),
                ))
                .with_record(SuggestionProvider::Weather.record(
                    "weather-1",
                    json!({
                        "min_keyword_length": 3,
                        "score": 0.24,
                        "keywords": [
                            "abcdefghik lmnopqrst"
                        ],
                    }),
                )),
        );

        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });

        store.read(|dao| {
            let cache = dao.weather_cache();
            assert_eq!(cache.keywords_metrics.max_len, 20);
            assert_eq!(cache.keywords_metrics.max_word_count, 5);
            Ok(())
        })?;

        // Delete the first record. The metrics should change.
        store
            .client_mut()
            .delete_record(SuggestionProvider::Weather.empty_record("weather-0"));
        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });
        store.read(|dao| {
            let cache = dao.weather_cache();
            assert_eq!(cache.keywords_metrics.max_len, 20);
            assert_eq!(cache.keywords_metrics.max_word_count, 2);
            Ok(())
        })?;

        // Add a new record. The metrics should change again.
        store
            .client_mut()
            .add_record(SuggestionProvider::Weather.record(
                "weather-3",
                json!({
                    "min_keyword_length": 3,
                    "score": 0.24,
                    "keywords": [
                        "abcde fghij klmno"
                    ]
                }),
            ));
        store.ingest(SuggestIngestionConstraints {
            providers: Some(vec![SuggestionProvider::Weather]),
            ..SuggestIngestionConstraints::all_providers()
        });
        store.read(|dao| {
            let cache = dao.weather_cache();
            assert_eq!(cache.keywords_metrics.max_len, 20);
            assert_eq!(cache.keywords_metrics.max_word_count, 3);
            Ok(())
        })?;

        Ok(())
    }
}
