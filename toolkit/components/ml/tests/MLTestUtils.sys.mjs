/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * @import { EngineResponses, EngineRequests, ChunkResponse, EngineFeatureIds } from "../ml.d.ts"
 */

/**
 * @typedef {string | string[] | ChunkResponse | ChunkResponse[] | EngineResponses["chat"]} MockedResponse
 */

/**
 * @typedef {object} MockedRequest
 * @property {EngineRequests["chat"]} request
 * @property {(response: MockedResponse) => void} resolve
 * @property {(reason: any) => void} reject
 */

const EXTRA_RESPONSE_ARGS = {
  metrics: [],
  resourcesBefore: { cpuTime: null, memory: null },
  resourcesAfter: { cpuTime: null, memory: null },
};

/**
 * Mock an LLM with artificial calls. This is useful for testing various user flows when
 * you want a deterministic response from the language model. Just swap out your chat
 * engine instance with this one.
 *
 * See toolkit/components/ml/tests/browser/browser_ml_mock_llm_engine.js for example usage.
 *
 * @template {EngineFeatureIds} FeatureID
 */
export class MockLLMEngine {
  #nextRequestId = 0;

  /** @type {Map<number, MockedRequest>} */
  #runRequests = new Map();

  get runRequests() {
    if (!Cu.isInAutomation) {
      throw new Error(
        "The MockLLMEngine#runRequests property must only be used in automation."
      );
    }
    return this.#runRequests;
  }

  /**
   * A convenience function get the next request that was sent.
   *
   * @returns {[number, MockedRequest]}
   */
  getNextRequest() {
    const { value, done } = this.#runRequests.entries().next();
    if (done) {
      throw new Error("There is no next request for the MockLLMEngine.");
    }
    return value;
  }

  /**
   * Intentionally reject all requests to clear out anything pending.
   */
  rejectAllRequests() {
    for (const [, { reject }] of this.#runRequests) {
      reject(new Error("Intentionally rejecting requests"));
    }
    this.#runRequests = new Map();
  }

  /**
   * Provide a deterministic artificial response from the language model. This
   * is only available from tests. If an array of strings is passed then the
   * response will simulate chunking behavior.
   *
   * @param {number} requestId
   * @param {MockedResponse} response
   */
  respond(requestId, response) {
    if (!Cu.isInAutomation) {
      throw new Error(
        "The MockLLMEngine#respond method must only be used in automation."
      );
    }

    const runRequest = this.#runRequests.get(requestId);
    this.#runRequests.delete(requestId);
    if (!runRequest) {
      throw new Error("Could not find a request with that id");
    }
    runRequest.resolve(response);
  }

  /**
   * Run the inference request with a MockedResponse. If the mocked response is a string
   * then the it is transformed into a structured response. If the mocked response is
   * an array of strings the response is concatenated. The array of strings gets turned
   * into a chunks only in the runWithGenerator method.
   *
   * @param {EngineRequests[FeatureID]} request
   * @returns {Promise<EngineResponses["chat"]>}
   */
  async run(request) {
    const requestId = this.#nextRequestId++;

    /**
     * The MockedResponse can take the multiple shapes. The actual returned
     * response will be modified in this utility to return the correct API response.
     *
     * @type {PromiseWithResolvers<MockedResponse>}
     */
    const { promise, resolve, reject } = Promise.withResolvers();
    this.#runRequests.set(requestId, { request, resolve, reject });
    const response = await promise;

    if (typeof response === "string") {
      return { finalOutput: response, ...EXTRA_RESPONSE_ARGS };
    }

    if (Array.isArray(response)) {
      let finalOutput = "";
      for (const text of response) {
        if (typeof text !== "string") {
          throw new Error(
            "Expected the mocked response to be a list of strings"
          );
        }
        finalOutput += text;
      }
      return { finalOutput, ...EXTRA_RESPONSE_ARGS };
    }

    if ("text" in response) {
      throw new Error(
        "The MockLLMEngine received a mocked ChunkResponse in the non-chunked API"
      );
    }

    return response;
  }

  /**
   * Run the inference request. If the mocked response is a string then a single chunk
   * is yielded, and the method returns. If the mocked response is an array of strings
   * then each string is yielded as chunk. An actual array of ChunkResponses can also
   * be provided.
   *
   * @param {EngineRequests[FeatureID]} request
   * @returns {AsyncGenerator<ChunkResponse>}
   */
  async *runWithGenerator(request) {
    const requestId = this.#nextRequestId++;

    // For manual testing without mockResponse, store the request and wait for respond()
    const { resolve, reject, promise } = Promise.withResolvers();
    this.#runRequests.set(requestId, { request, resolve, reject });

    // Wait for respond() to be called with a response
    const response = await promise;

    if (typeof response === "string") {
      yield {
        text: response,
        tokens: null,
        isPrompt: false,
        toolCalls: [],
      };
      return;
    }

    if (Array.isArray(response)) {
      for (const chunk of response) {
        // Wait a micro-tick to make this really async.
        await Promise.resolve();

        if (typeof chunk === "string") {
          // The chunk is just a string, wrap it in a ChunkResponse.
          yield {
            text: chunk,
            tokens: null,
            isPrompt: false,
            toolCalls: [],
          };
        } else {
          // This is already a ChunkResponse object.
          yield chunk;
        }
      }
      return;
    }

    if (!response) {
      throw new Error("No response was received for the MockLLMEngine.");
    }

    if (typeof response.text !== "string") {
      throw new Error(
        'Expected the MockedLLMEngine response to include a "text" property.'
      );
    }

    yield response;
  }
}

/**
 * Utilities for ML component and evaluation testing.
 */
export const MLTestUtils = {
  MockLLMEngine,

  /**
   * Gather just the text for the chunked response to an LLM call.
   *
   * @param {AsyncGenerator<ChunkResponse>} generator
   * @returns {Promise<string>}
   */
  async gatherText(generator) {
    let fullText = "";
    for await (const chunk of generator) {
      if (chunk.text) {
        fullText += chunk.text;
      }
    }
    return fullText;
  },

  /**
   * Run the the MockLLMEngine's generator and gather the chunks into an array.
   *
   * @param {AsyncGenerator<ChunkResponse>} generator
   * @returns {Promise<ChunkResponse[]>}
   */
  async gatherChunks(generator) {
    /** @type {ChunkResponse[]} */
    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }
    return chunks;
  },

  /**
   * Report eval data out to stdout, which will be picked up by the mozperftest test
   * harness for analysis and evaluation metrics. This function should only be used from
   * browser_eval tests via `./mach eval`
   *
   * The data is logged in two formats:
   * 1. As a dump with "evalDataPayload |" prefix for parsing
   * 2. As a formatted dump for human readability
   *
   * @param {any} data - JSON serializable data containing evaluation results.
   * @param {boolean} prettyPrint - Optionally print the results in a human readable
   *   format as well.
   */
  reportEvalData(data, prettyPrint = false) {
    const payload = JSON.stringify(data);
    dump("evalDataPayload | " + payload + "\n");
    if (prettyPrint) {
      dump("-------------------------------------\n");
      dump("Eval data:\n");
      dump(JSON.stringify(data, null, 2));
      dump("\n");
    }
  },
};
