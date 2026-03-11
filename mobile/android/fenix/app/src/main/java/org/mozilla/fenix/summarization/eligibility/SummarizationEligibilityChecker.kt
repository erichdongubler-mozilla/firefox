/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.summarization.eligibility

import kotlinx.coroutines.suspendCancellableCoroutine
import mozilla.components.concept.engine.EngineSession
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Checks if a session is eligible for summarization
 */
fun interface SummarizationEligibilityChecker {

    /**
     * Checks if a session is eligible for summarization
     *
     * @param session The session to check
     */
    suspend fun check(session: EngineSession): Result<Unit>
}

/**
 * Default implementation for checking if a content is eligible for summarization
 */
internal class DefaultSummarizationEligibilityChecker : SummarizationEligibilityChecker {

    override suspend fun check(session: EngineSession): Result<Unit> {
        // Remove in https://bugzilla.mozilla.org/show_bug.cgi?id=2020509 has landed
        // we will no longer need to get the entire page content just to check for eligibility
        return session.getPageContent()
            .map { content ->
                content.checkWordCount()
            }
    }

    private suspend fun EngineSession.getPageContent() = runCatching {
        suspendCancellableCoroutine { continuation ->
            getPageContent(
                onResult = { content ->
                    continuation.resume(content)
                },
                onException = { error ->
                    continuation.resumeWithException(error)
                },
            )
        }
    }

    private fun String?.checkWordCount(range: IntRange = WORD_COUNT_RANGE): Boolean {
        val wordCount = this?.split("\\s+".toRegex())
            ?.count { it.trim().isNotEmpty() } ?: return false

        return range.contains(wordCount)
    }

    companion object {
        private val WORD_COUNT_RANGE = IntRange(100, 5000)
    }
}
