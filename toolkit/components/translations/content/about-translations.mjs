/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The following globals are injected via the AboutTranslationsChild actor.
// about-translations.mjs is running in an unprivileged context, and these injected functions
// allow for the page to get access to additional privileged features.

/* global AT_getSupportedLanguages, AT_log, AT_getScriptDirection,
   AT_logError, AT_createTranslationsPort, AT_isHtmlTranslation,
   AT_isTranslationEngineSupported, AT_identifyLanguage, AT_telemetry */

import { Translator } from "chrome://global/content/translations/Translator.mjs";
import { TranslationsUtils } from "chrome://global/content/translations/TranslationsUtils.mjs";

// Allow tests to override this value so that they can run faster.
// This is the delay in milliseconds.
window.DEBOUNCE_DELAY = 200;
// Allow tests to test the debounce behavior by counting debounce runs.
window.DEBOUNCE_RUN_COUNT = 0;

// Limits how long the "text" parameter can be in the URL.
const URL_MAX_TEXT_LENGTH = 5000;

const l10nIds = {
  resultsPlaceholder: "about-translations-results-placeholder",
  translatingMessage: "about-translations-translating-message",
};

/**
 * @typedef {import("../translations").SupportedLanguages} SupportedLanguages
 */

/**
 * The model and controller for initializing about:translations.
 */
class TranslationsState {
  /**
   * This class is responsible for all UI updated.
   *
   * @type {TranslationsUI}
   */
  ui;

  /**
   * The language to translate from, in the form of a BCP 47 language tag,
   * e.g. "en" or "fr".
   *
   * @type {string}
   */
  sourceLanguage = "";

  /**
   * The language to translate to, in the form of a BCP 47 language tag,
   * e.g. "en" or "fr".
   *
   * @type {string}
   */
  targetLanguage = "";

  /**
   * The model variant.
   *
   * @type {string | undefined}
   */
  sourceVariant;

  /**
   * The model variant.
   *
   * @type {string | undefined}
   */
  targetVariant;

  /**
   * @type {LanguagePair | null}
   */
  languagePair = null;

  /**
   * The message to translate, cached so that it can be determined if the text
   * needs to be re-translated.
   *
   * @type {string}
   */
  messageToTranslate = "";

  /**
   * Only send one translation in at a time to the worker.
   *
   * @type {Promise<string[]>}
   */
  translationRequest = Promise.resolve([]);

  /**
   * The translator is only valid for a single language pair, and needs
   * to be recreated if the language pair changes.
   *
   * @type {null | Translator}
   */
  translator = null;

  /**
   * @param {boolean} isSupported
   */
  constructor(isSupported) {
    /**
     * Is the engine supported by the device?
     *
     * @type {boolean}
     */
    this.isTranslationEngineSupported = isSupported;

    /**
     * @type {SupportedLanguages}
     */
    this.supportedLanguages = isSupported
      ? AT_getSupportedLanguages()
      : Promise.resolve([]);

    this.ui = new TranslationsUI(this);
    this.ui.setup();

    // Set the UI as ready after all of the state promises have settled.
    this.updateFromURL()
      .then(() => {
        this.ui.setAsReady();
      })
      .catch(error => {
        AT_logError("Failed to load the supported languages", error);
      });
  }

  /**
   * Identifies the human language in which the message is written and returns
   * the BCP 47 language tag of the language it is determined to be.
   *
   * e.g. "en" for English.
   *
   * @param {string} message
   */
  async identifyLanguage(message) {
    const start = performance.now();
    const { langTag, confidence } = await AT_identifyLanguage(message);
    const duration = performance.now() - start;
    AT_log(
      `[ ${langTag}(${(confidence * 100).toFixed(2)}%) ]`,
      `Source language identified in ${duration / 1000} seconds`
    );
    return langTag;
  }

  /**
   * Update the translation state from the src, trg, and text
   * URL parameters when the page is opened or reloaded.
   */
  async updateFromURL() {
    let supportedLanguages = await this.supportedLanguages;
    let newParams = new URLSearchParams(window.location.href.split("#")[1]);
    let newSrc = newParams.get("src");
    let newTrg = newParams.get("trg");
    let newText = newParams.get("text");
    if (!newText) {
      newText = "";
    }
    this.messageToTranslate = newText;
    this.ui.translationFrom.value = newText;

    if (newSrc == "detect") {
      // Check if target is in supported languages
      if (
        !supportedLanguages.targetLanguages.some(
          ({ langTag }) => langTag === newTrg
        )
      ) {
        this.ui.updateTranslation("");
        return;
      }
    } else if (
      // The language pair is invalid
      !supportedLanguages.languagePairs.some(
        ({ sourceLanguage, targetLanguage }) =>
          sourceLanguage === newSrc && targetLanguage === newTrg
      ) &&
      // English pivot cannot be used
      !(
        supportedLanguages.languagePairs.some(
          ({ sourceLanguage, targetLanguage }) =>
            sourceLanguage === newSrc && targetLanguage === "en"
        ) &&
        supportedLanguages.languagePairs.some(
          ({ sourceLanguage, targetLanguage }) =>
            sourceLanguage === "en" && targetLanguage === newTrg
        )
      )
    ) {
      this.ui.updateTranslation("");
      return;
    }

    // Update the parameters if they have changed
    this.sourceLanguage = newSrc;
    this.targetLanguage = newTrg;
    this.messageToTranslate = newText;
    this.ui.sourceLanguage.value = newSrc;
    this.ui.targetLanguage.value = newTrg;
    this.ui.translationFrom.value = newText;
    this.maybeUpdateDetectedLanguage();
    this.maybeCreateNewTranslator();
    if (newSrc === "detect") {
      await this.maybeUpdateDetectedLanguage();
    }
    await this.maybeCreateNewTranslator();
  }

  /**
   * Update the URL with the current state whenever a translation is
   * requested or languages are modified.
   *
   * If the text is too long, it is truncated to URL_MAX_TEXT_LENGTH.
   */
  async updateURL() {
    let params = new URLSearchParams();
    if (this.ui.detectOptionIsSelected()) {
      params.append("src", "detect");
    } else if (this.ui.sourceLanguage.value) {
      params.append("src", encodeURIComponent(this.ui.sourceLanguage.value));
    }

    if (this.ui.targetLanguage.value) {
      params.append("trg", encodeURIComponent(this.ui.targetLanguage.value));
    }

    let textParam = this.messageToTranslate;
    let tooLong = textParam.length > URL_MAX_TEXT_LENGTH;
    textParam = tooLong
      ? textParam
      : textParam.substring(0, URL_MAX_TEXT_LENGTH);

    if (textParam) {
      params.append("text", textParam);
    }

    window.location.hash = params;
  }

  /**
   * Only request a translation when it's ready.
   */
  maybeRequestTranslation = debounce({
    /**
     * Debounce the translation requests so that the worker doesn't fire for every
     * single keyboard input, but instead the keyboard events are ignored until
     * there is a short break, or enough events have happened that it's worth sending
     * in a new translation request.
     */
    onDebounce: async () => {
      // If a translation is requested, something may have changed that needs to be updated in the url
      this.updateURL();
      if (!this.isTranslationEngineSupported) {
        // Never translate when the engine isn't supported.
        return;
      }

      // The contents of "this" can change between async steps, store a local variable
      // binding of these values.
      const { messageToTranslate, translator, languagePair } = this;

      if (!languagePair || !messageToTranslate || !translator) {
        // Not everything is set for translation.
        this.ui.updateTranslation("");
        return;
      }

      // Ensure the previous translation has finished so that only the latest
      // translation goes through.
      await this.translationRequest;

      if (
        // Check if the current configuration has changed and if this is stale. If so
        // then skip this request, as there is already a newer request with more up to
        // date information.
        this.translator !== translator ||
        this.languagePair !== languagePair ||
        this.messageToTranslate !== messageToTranslate
      ) {
        return;
      }

      const start = performance.now();
      this.translationRequest = this.translator.translate(
        messageToTranslate,
        AT_isHtmlTranslation()
      );
      this.ui.setResultPlaceholderTextContent(l10nIds.translatingMessage);
      const translation = await this.translationRequest;
      this.ui.setResultPlaceholderTextContent(l10nIds.resultsPlaceholder);

      // The measure events will show up in the Firefox Profiler.
      performance.measure(
        `Translations: Translate "${this.languagePairKey}" with ${messageToTranslate.length} characters.`,
        {
          start,
          end: performance.now(),
        }
      );

      this.ui.updateTranslation(translation);
      const duration = performance.now() - start;
      AT_log(`Translation done in ${duration / 1000} seconds`);
    },

    // Mark the events so that they show up in the Firefox Profiler. This makes it handy
    // to visualize the debouncing behavior.
    doEveryTime: () => {
      performance.mark(
        `Translations: input changed to ${this.messageToTranslate.length} characters`
      );
    },
  });

  /**
   * Any time a language pair is changed, a new Translator needs to be created.
   */
  async maybeCreateNewTranslator() {
    // If we may need to re-building the worker, the old translation is no longer valid.
    this.ui.updateTranslation("");
    // These are cases in which it wouldn't make sense or be possible to load any translations models.

    if (
      // If sourceLanguage or targetLanguage are unpopulated we cannot load anything.
      !this.sourceLanguage ||
      !this.targetLanguage ||
      // If sourceLanguage's value is "detect", rather than a BCP 47 language tag, then no language
      // has been detected yet.
      this.sourceLanguage === "detect" ||
      // If sourceLanguage and targetLanguage are the same, this means that the detected language
      // is the same as the targetLanguage, and we do not want to translate from one language to itself.
      this.sourceLanguage === this.targetLanguage ||
      // If the state's languages do not match the UI's languages, then we may be in the middle of
      // transitioning the state, so we should not create a new translator yet.
      this.targetLanguage !== this.ui.targetLanguage.value ||
      (this.sourceLanguage !== this.ui.sourceLanguage.value &&
        this.ui.sourceLanguage.value !== "detect")
    ) {
      return;
    }

    const start = performance.now();
    AT_log(
      `Creating a new translator for "${this.sourceLanguage}" to "${this.targetLanguage}"`
    );

    const requestTranslationsPort = languagePair => {
      const { promise, resolve } = Promise.withResolvers();

      const getResponse = ({ data }) => {
        if (
          data.type == "GetTranslationsPort" &&
          data.languagePair.sourceLanguage === languagePair.sourceLanguage &&
          data.languagePair.targetLanguage === languagePair.targetLanguage &&
          data.languagePair.sourceVariant == languagePair.sourceVariant &&
          data.languagePair.targetVariant == languagePair.targetVariant
        ) {
          window.removeEventListener("message", getResponse);
          resolve(data.port);
        }
      };

      window.addEventListener("message", getResponse);
      AT_createTranslationsPort(languagePair);

      return promise;
    };

    this.languagePair = {
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      sourceVariant: this.sourceVariant,
      targetVariant: this.targetVariant,
    };
    this.languagePairKey = TranslationsUtils.serializeLanguagePair(
      this.languagePair
    );

    try {
      const translatorPromise = Translator.create(
        this.languagePair,
        requestTranslationsPort
      );
      const duration = performance.now() - start;

      // Signal to tests that the translator was created so they can exit.
      window.postMessage("translator-ready");

      this.translator = await translatorPromise;
      AT_log(`Created a new Translator in ${duration / 1000} seconds`);

      this.maybeRequestTranslation();
    } catch (error) {
      this.languagePair = null;
      this.languagePairKey = null;
      this.ui.showInfo("about-translations-engine-error");
      this.ui.setResultPlaceholderTextContent(l10nIds.resultsPlaceholder);
      AT_logError("Failed to get the Translations worker", error);
    }
  }

  /**
   * Updates the sourceLanguage to match the detected language only if the
   * about-translations-detect option is selected in the language-from dropdown.
   *
   * If the new sourceLanguage is different than the previous sourceLanguage this
   * may update the UI to display the new language and may rebuild the translations
   * worker if there is a valid selected target language.
   */
  async maybeUpdateDetectedLanguage() {
    if (!this.ui.detectOptionIsSelected() || this.messageToTranslate === "") {
      // If we are not detecting languages or if the message has been cleared
      // we should ensure that the UI is not displaying a detected language
      // and there is no need to run any language detection.
      this.ui.setDetectOptionTextContent("");
      return;
    }

    const [langTag, supportedLanguages] = await Promise.all([
      this.identifyLanguage(this.messageToTranslate),
      this.supportedLanguages,
    ]);

    // Only update the language if the detected language matches
    // one of our supported languages.
    const entry = supportedLanguages.sourceLanguages.find(
      ({ langTag: existingTag }) => existingTag === langTag
    );
    if (entry) {
      const { displayName } = entry;
      await this.setSourceLanguage(langTag);
      this.ui.setDetectOptionTextContent(displayName);
    }
  }

  /**
   * @param {string} langTagKey
   */
  async setSourceLanguage(langTagKey) {
    const [langTag, variant] = langTagKey.split(",");
    if (langTag !== this.sourceLanguage || variant !== this.sourceVariant) {
      this.sourceLanguage = langTag;
      this.sourceVariant = variant;
      await this.maybeCreateNewTranslator();
    }
  }

  /**
   * @param {string} langTagKey
   */
  setTargetLanguage(langTagKey) {
    const [langTag, variant] = langTagKey.split(",");
    if (langTag !== this.targetLanguage || this.targetVariant !== variant) {
      this.targetLanguage = langTag;
      this.targetVariant = variant;
      this.maybeCreateNewTranslator();
    }
  }

  /**
   * @param {string} message
   */
  async setMessageToTranslate(message) {
    if (message !== this.messageToTranslate) {
      this.messageToTranslate = message;
      await this.maybeUpdateDetectedLanguage();
      this.maybeRequestTranslation();
    }
  }
}

/**
 *
 */
class TranslationsUI {
  /** @type {HTMLSelectElement} */
  sourceLanguage = document.getElementById("language-from");
  /** @type {HTMLSelectElement} */
  targetLanguage = document.getElementById("language-to");
  /** @type {HTMLButtonElement} */
  languageSwap = document.getElementById("language-swap");
  /** @type {HTMLTextAreaElement} */
  translationFrom = document.getElementById("translation-from");
  /** @type {HTMLDivElement} */
  translationTo = document.getElementById("translation-to");
  /** @type {HTMLDivElement} */
  translationToBlank = document.getElementById("translation-to-blank");
  /** @type {HTMLDivElement} */
  translationInfo = document.getElementById("translation-info");
  /** @type {HTMLDivElement} */
  translationInfoMessage = document.getElementById("translation-info-message");
  /** @type {HTMLDivElement} */
  translationResultsPlaceholder = document.getElementById(
    "translation-results-placeholder"
  );
  /** @type {HTMLElement} */
  messageBar = document.getElementById("messageBar");
  /** @type {TranslationsState} */
  state;

  /**
   * The detect-language option element. We want to maintain a handle to this so that
   * we can dynamically update its display text to include the detected language.
   *
   * @type {HTMLOptionElement}
   */
  #detectOption;

  /**
   * @param {TranslationsState} state
   */
  constructor(state) {
    this.state = state;
    this.translationTo.style.visibility = "visible";
    this.#detectOption = document.querySelector('option[value="detect"]');
    AT_telemetry("onOpen", {
      maintainFlow: false,
    });
  }

  /**
   * Do the initial setup.
   */
  setup() {
    if (!this.state.isTranslationEngineSupported) {
      this.showInfo("about-translations-no-support");
      this.disableUI();
      return;
    }
    this.setupDropdowns().catch(error => {
      console.error("Failed to set up dropdowns:", error);
      this.showError("about-translations-language-load-error");
    });
    this.setupTextarea();
    this.setupLanguageSwapButton();
  }

  /**
   * Signals that the UI is ready, for tests.
   */
  setAsReady() {
    document.body.setAttribute("ready", "");
  }

  /**
   * Once the models have been synced from remote settings, populate them with the display
   * names of the languages.
   */
  async setupDropdowns() {
    const supportedLanguages = await this.state.supportedLanguages;

    // Update the DOM elements with the display names.
    for (const {
      langTagKey,
      displayName,
    } of supportedLanguages.targetLanguages) {
      const option = document.createElement("option");
      option.value = langTagKey;
      option.text = displayName;
      this.targetLanguage.add(option);
    }

    for (const {
      langTagKey,
      displayName,
    } of supportedLanguages.sourceLanguages) {
      const option = document.createElement("option");
      option.value = langTagKey;
      option.text = displayName;
      this.sourceLanguage.add(option);
    }

    // Enable the controls.
    this.sourceLanguage.disabled = false;
    this.targetLanguage.disabled = false;

    // Focus the language dropdowns if they are empty.
    if (this.sourceLanguage.value == "") {
      this.sourceLanguage.focus();
    } else if (this.targetLanguage.value == "") {
      this.targetLanguage.focus();
    }

    this.state.setSourceLanguage(this.sourceLanguage.value);
    this.state.setTargetLanguage(this.targetLanguage.value);

    await this.updateOnLanguageChange();

    this.sourceLanguage.addEventListener("input", async () => {
      this.state.targetLanguage = this.targetLanguage.value;
      this.translationTo.setAttribute("lang", this.targetLanguage.value);
      this.state.setSourceLanguage(this.sourceLanguage.value);

      await this.updateOnLanguageChange();
    });

    this.targetLanguage.addEventListener("input", async () => {
      this.state.sourceLanguage = this.sourceLanguage.value;
      this.translationTo.setAttribute("lang", this.targetLanguage.value);
      this.state.setTargetLanguage(this.targetLanguage.value);

      await this.updateOnLanguageChange();
    });
  }

  /**
   * Sets up the language swap button, so that when it's clicked, it:
   * - swaps the selected source adn target lanauges
   * - replaces the text to translate with the previous translation result
   */
  setupLanguageSwapButton() {
    this.languageSwap.addEventListener("click", async () => {
      const translationToValue = this.translationTo.innerText;

      const newSourceLanguage = this.sanitizeTargetLangTagAsSourceLangTag(
        this.targetLanguage.value
      );
      const newTargetLanguage =
        this.sanitizeSourceLangTagAsTargetLangTag(this.sourceLanguage.value) ||
        this.state.sourceLanguage;

      this.sourceLanguage.value = newSourceLanguage;
      this.state.sourceLanguage = newSourceLanguage;

      this.targetLanguage.value = newTargetLanguage;
      this.state.targetLanguage = newTargetLanguage;

      this.translationFrom.value = translationToValue;
      this.state.messageToTranslate = translationToValue;

      await this.updateOnLanguageChange();

      if (newSourceLanguage == "detect") {
        await this.state.maybeUpdateDetectedLanguage();
      }

      await this.state.maybeCreateNewTranslator();
    });
  }

  /**
   * Get the target language dropdown option equivalent to the given source language dropdown option.
   * `detect` will be converted to `` as `detect` is not a valid option in the target language dropdown
   *
   * @param {string} sourceLangTag
   */
  sanitizeSourceLangTagAsTargetLangTag(sourceLangTag) {
    if (sourceLangTag === "detect") {
      return "";
    }
    return sourceLangTag;
  }

  /**
   * Get the source language dropdown option equivalent to the given target language dropdown option.
   * `` will be converted to `detect` as `` is not a valid option in the source language dropdown
   *
   * @param {string} targetLangTag
   */
  sanitizeTargetLangTagAsSourceLangTag(targetLangTag) {
    if (targetLangTag === "") {
      return "detect";
    }
    return targetLangTag;
  }

  /**
   * Show an error message to the user.
   *
   * @param {string} l10nId
   */
  showError(l10nId) {
    document.l10n.setAttributes(this.messageBar, l10nId);
    this.messageBar.hidden = false;
    this.messageBar.setAttribute("type", "error");
  }

  /**
   * Show an info message to the user.
   *
   * @param {string} l10nId
   */
  showInfo(l10nId) {
    document.l10n.setAttributes(this.messageBar, l10nId);
    this.messageBar.hidden = false;
    this.messageBar.setAttribute("type", "info");
  }

  /**
   * Hides the info UI.
   */
  hideInfo() {
    this.translationInfo.style.display = "none";
  }

  /**
   * Returns true if about-translations-detect is the currently
   * selected option in the language-from dropdown, otherwise false.
   *
   * @returns {boolean}
   */
  detectOptionIsSelected() {
    return this.sourceLanguage.value === "detect";
  }

  /**
   * Sets the textContent of the about-translations-detect option in the
   * language-from dropdown to include the detected language's display name.
   *
   * @param {string} displayName
   */
  setDetectOptionTextContent(displayName) {
    // Set the text to the fluent value that takes an arg to display the language name.
    if (displayName) {
      document.l10n.setAttributes(
        this.#detectOption,
        "about-translations-detect-lang",
        { language: displayName }
      );
    } else {
      // Reset the text to the fluent value that does not display any language name.
      document.l10n.setAttributes(
        this.#detectOption,
        "about-translations-detect"
      );
    }
  }

  /**
   * Sets the translation result placeholder text based on the l10n id provided
   *
   * @param {string} l10nId
   */
  setResultPlaceholderTextContent(l10nId) {
    document.l10n.setAttributes(this.translationResultsPlaceholder, l10nId);
  }

  /**
   * React to language changes.
   */
  async updateOnLanguageChange() {
    this.#updateDropdownLanguages();
    this.#updateMessageDirections();
    await this.#updateLanguageSwapButton();
    this.state.updateURL();
  }

  /**
   * You cant translate from one language to another language. Hide the options
   * if this is the case.
   */
  #updateDropdownLanguages() {
    for (const option of this.sourceLanguage.options) {
      option.hidden = false;
    }
    for (const option of this.targetLanguage.options) {
      option.hidden = false;
    }
    if (this.state.targetLanguage) {
      const option = this.sourceLanguage.querySelector(
        `[value=${this.state.targetLanguage}]`
      );
      if (option) {
        option.hidden = true;
      }
    }
    if (this.state.sourceLanguage) {
      const option = this.targetLanguage.querySelector(
        `[value=${this.state.sourceLanguage}]`
      );
      if (option) {
        option.hidden = true;
      }
    }
    this.state.maybeUpdateDetectedLanguage();
  }

  /**
   * Define the direction of the language message text, otherwise it might not display
   * correctly. For instance English in an RTL UI would display incorrectly like so:
   *
   * LTR text in LTR UI:
   *
   * ┌──────────────────────────────────────────────┐
   * │ This is in English.                          │
   * └──────────────────────────────────────────────┘
   *
   * LTR text in RTL UI:
   * ┌──────────────────────────────────────────────┐
   * │                          .This is in English │
   * └──────────────────────────────────────────────┘
   *
   * LTR text in RTL UI, but in an LTR container:
   * ┌──────────────────────────────────────────────┐
   * │ This is in English.                          │
   * └──────────────────────────────────────────────┘
   *
   * The effects are similar, but reversed for RTL text in an LTR UI.
   */
  #updateMessageDirections() {
    if (this.state.targetLanguage) {
      this.translationTo.setAttribute(
        "dir",
        AT_getScriptDirection(this.state.targetLanguage)
      );
    } else {
      this.translationTo.removeAttribute("dir");
    }
    if (this.state.sourceLanguage) {
      this.translationFrom.setAttribute(
        "dir",
        AT_getScriptDirection(this.state.sourceLanguage)
      );
    } else {
      this.translationFrom.removeAttribute("dir");
    }
  }

  /**
   * Disable the language swap button if sourceLanguage is equivalent to targetLanguage, or if the languages are not a valid option in the opposite direction
   */
  async #updateLanguageSwapButton() {
    const sourceLanguage = this.state.sourceLanguage;
    const targetLanguage = this.state.targetLanguage;

    if (
      sourceLanguage ===
      this.sanitizeTargetLangTagAsSourceLangTag(targetLanguage)
    ) {
      this.languageSwap.disabled = true;
      return;
    }

    if (this.translationFrom.value && !this.translationTo.innerText) {
      this.languageSwap.disabled = true;
      return;
    }

    const supportedLanguages = await this.state.supportedLanguages;

    const isSourceLanguageValidAsTargetLanguage =
      sourceLanguage === "detect" ||
      supportedLanguages.languagePairs.some(
        ({ targetLanguage }) => targetLanguage === sourceLanguage
      );
    const isTargetLanguageValidAsSourceLanguage =
      targetLanguage === "" ||
      supportedLanguages.languagePairs.some(
        ({ sourceLanguage }) => sourceLanguage === targetLanguage
      );

    this.languageSwap.disabled =
      !isSourceLanguageValidAsTargetLanguage ||
      !isTargetLanguageValidAsSourceLanguage;
  }

  setupTextarea() {
    this.state.setMessageToTranslate(this.translationFrom.value);
    this.translationFrom.addEventListener("input", async () => {
      await this.state.setMessageToTranslate(this.translationFrom.value);
      this.#updateLanguageSwapButton();
    });
  }

  disableUI() {
    this.translationFrom.disabled = true;
    this.sourceLanguage.disabled = true;
    this.targetLanguage.disabled = true;
    this.languageSwap.disabled = true;
  }

  /**
   * @param {string} message
   */
  updateTranslation(message) {
    this.translationTo.innerText = message;
    if (message) {
      this.translationTo.style.visibility = "visible";
      this.translationToBlank.style.visibility = "hidden";
      this.hideInfo();
    } else {
      this.translationTo.style.visibility = "hidden";
      this.translationToBlank.style.visibility = "visible";
    }
    this.#updateLanguageSwapButton();
  }
}

/**
 * Listen for events coming from the AboutTranslations actor.
 */
window.addEventListener("AboutTranslationsChromeToContent", ({ detail }) => {
  switch (detail.type) {
    case "enable": {
      // While the feature is in development, hide the feature behind a pref. See the
      // "browser.translations.enable" pref in modules/libpref/init/all.js and Bug 971044
      // for the status of enabling this project.
      if (window.translationsState) {
        throw new Error("about:translations was already initialized.");
      }
      AT_isTranslationEngineSupported().then(isSupported => {
        window.translationsState = new TranslationsState(isSupported);
      });
      document.body.style.visibility = "visible";
      break;
    }
    case "rebuild-translator": {
      window.translationsState.maybeCreateNewTranslator();
      break;
    }
    default:
      throw new Error("Unknown AboutTranslationsChromeToContent event.");
  }
});

/**
 * Debounce a function so that it is only called after some wait time with no activity.
 * This is good for grouping text entry via keyboard.
 *
 * @param {object} settings
 * @param {Function} settings.onDebounce
 * @param {Function} settings.doEveryTime
 * @returns {Function}
 */
function debounce({ onDebounce, doEveryTime }) {
  /** @type {number | null} */
  let timeoutId = null;
  let lastDispatch = null;

  return (...args) => {
    doEveryTime(...args);

    const now = Date.now();
    if (lastDispatch === null) {
      // This is the first call to the function.
      lastDispatch = now;
    }

    const timeLeft = lastDispatch + window.DEBOUNCE_DELAY - now;

    // Always discard the old timeout, either the function will run, or a new
    // timer will be scheduled.
    clearTimeout(timeoutId);

    if (timeLeft <= 0) {
      // It's been long enough to go ahead and call the function.
      timeoutId = null;
      lastDispatch = null;
      window.DEBOUNCE_RUN_COUNT += 1;
      onDebounce(...args);
      return;
    }

    // Re-set the timeout with the current time left.
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      // Timeout ended, call the function.
      timeoutId = null;
      lastDispatch = null;
      window.DEBOUNCE_RUN_COUNT += 1;
      onDebounce(...args);
    }, timeLeft);
  };
}
