/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use nsstring::nsString;
use serde::{Deserialize, Deserializer};

#[derive(Clone, Copy, Deserialize, Default)]
#[repr(u8)]
pub enum DeclarativePushDir {
    #[serde(rename = "ltr")]
    Ltr,
    #[serde(rename = "rtl")]
    Rtl,
    #[serde(rename = "auto")]
    #[default]
    Auto,
}

// serde_json deserialization for Option fails if the value is present
// but with the wrong type. However, the spec instead ignores such values,
// so we need our own deserializer. This uses T::default() if the value has
// the wrong type.
fn forgiving_deserialize<'a, T: Deserialize<'a> + Default, D: Deserializer<'a>>(
    deserializer: D,
) -> Result<T, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Forgiving<T> {
        Ok(T),
        #[allow(dead_code)]
        WrongType(serde_json::Value),
    }
    let result: Forgiving<T> = Deserialize::deserialize(deserializer)?;
    Ok(match result {
        Forgiving::Ok(value) => value,
        _ => T::default(),
    })
}

#[repr(C)]
pub struct DeclarativePushData {
    title: nsString,
    navigate: nsString,
    lang: nsString,
    body: nsString,
    icon: nsString,
    tag: nsString,
    dir: DeclarativePushDir,
    silent: bool,
    require_interaction: bool,
}

/// notification member of https://w3c.github.io/push-api/#members
#[derive(Deserialize)]
#[allow(non_snake_case)]
struct NotificationJSON {
    title: String,
    navigate: String,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    dir: DeclarativePushDir,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    lang: String,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    body: String,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    tag: String,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    icon: String,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    silent: bool,
    #[serde(default, deserialize_with = "forgiving_deserialize")]
    requireInteraction: bool,
}

/// Declarative push message data. https://w3c.github.io/push-api/#members
#[derive(Deserialize)]
struct DeclarativePushJSON {
    web_push: u16,
    notification: NotificationJSON,
}

// https://w3c.github.io/push-api/#dfn-declarative-push-message-parser
fn parse_declarative_push_option(data: &[u8]) -> Option<DeclarativePushData> {
    // Step 1: Let message be the result of parsing JSON bytes to an Infra value given bytes.
    //         If that throws an exception, then return failure.
    // (Leads to https://encoding.spec.whatwg.org/#utf-8-decode which does lossy decoding)
    let string = String::from_utf8_lossy(data);
    let data: DeclarativePushJSON = serde_json::from_str(string.as_ref()).ok()?;
    if data.web_push != 8030 {
        return None;
    }
    let notification = data.notification;
    Some(DeclarativePushData {
        title: nsString::from(&notification.title),
        navigate: nsString::from(&notification.navigate),
        dir: notification.dir,
        lang: nsString::from(&notification.lang),
        body: nsString::from(&notification.body),
        icon: nsString::from(&notification.icon),
        tag: nsString::from(&notification.tag),
        silent: notification.silent,
        require_interaction: notification.requireInteraction,
    })
}

/// Parse declarative push message.
/// https://w3c.github.io/push-api/#dfn-declarative-push-message-parser
#[unsafe(no_mangle)]
pub unsafe extern "C" fn parse_declarative_push(
    data: *const u8,
    length: usize,
    output: &mut DeclarativePushData,
) -> bool {
    match parse_declarative_push_option(unsafe { std::slice::from_raw_parts(data, length) }) {
        Some(push) => {
            *output = push;
            true
        }
        None => false,
    }
}
