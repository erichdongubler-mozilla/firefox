/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.core

import android.os.SystemClock
import androidx.compose.ui.test.SemanticsNodeInteractionCollection
import org.mozilla.fenix.ui.efficiency.helpers.Selector
import org.mozilla.fenix.ui.efficiency.logging.TimedReporter

/**
 * The shapes every element verb has. Each announces the command, resolves, retries once if a known overlay was covering
 * the target, reports, dumps the screen and throws with the selector named - so no verb has to, and no two verbs can
 * disagree about it.
 *
 * Every verb reports, because the structured log stream is the source of truth for what a test actually did - it is
 * what effpretty renders and what effverify grades, so the shape of what is emitted here is a consumed interface, not
 * an implementation detail.
 *
 * Seven shapes:
 *
 * - [require] one element must satisfy something; then act on it
 * - [requireAbsent] one element must not be there, now or for a while
 * - [requireAll] something must hold across every match for a selector
 * - [driveUntil] repeat an action until the screen changes the way you want
 * - [groupPresent] are all of a group's selectors on screen? answered, not thrown
 * - [requireState] poll a condition that has no selector behind it
 * - [reportAround] put the reporting around a call that throws on its own
 *
 * A verb is now a name, a policy, a predicate and an action. Each returns its receiver, so a page-object verb is a
 * single expression rather than a block ending in `return this`.
 */

/**
 * Resolve [selector], satisfy [predicate], then run [action]. Throws AssertionError naming the selector if it cannot,
 * having dumped the screen first.
 *
 * @return the receiver
 */
fun <T : VerbHost> T.require(
    verb: String,
    selector: Selector,
    expectation: String = "present",
    policy: WaitPolicy = WaitPolicy.Immediate,
    applyPreconditions: Boolean = true,
    dumpOnFailure: Boolean = true,
    optional: Boolean = false,
    via: ((Selector, Boolean) -> ElementResolution)? = null,
    predicate: (UiElement) -> Boolean = { true },
    action: (UiElement) -> Unit = {},
): T {
    val cmd = cmd(verb, selector.description, "Attempting to $verb '${selector.description}'...")

    val probe = seek(selector, policy, applyPreconditions, predicate, via)
    val element = probe.matched
    if (element == null) {
        probe.last.problem(selector)?.let {
            failLookup(cmd, verb, selector, expectation, dumpOnFailure, it)
        }
        if (optional && probe.located == null) {
            cmd.skip("'${selector.description}' not present; skipped", facts(verb, selector, Failure.NOT_FOUND))
            return this
        }
        // Keep "not on screen" and "on screen but wrong state" distinguishable. The verbs this
        // replaced threw two different errors for the two cases, and collapsing them into one
        // predicate would have made every state failure read as a missing element.
        val notFound = probe.located == null
        val message =
            if (notFound) {
                "'${selector.description}' not found"
            } else {
                "'${selector.description}' was found but $expectation was false"
            }
        cmd.fail(
            message,
            facts =
                facts(
                    verb,
                    selector,
                    if (notFound) Failure.NOT_FOUND else Failure.WRONG_STATE,
                    expectation,
                    dumpRef(dumpOnFailure, verb, selector),
                ),
        )
        if (dumpOnFailure) dumpFailure("$verb failed: ${selector.description}")
        throw AssertionError("$message (${selector.strategy} -> ${selector.value})")
    }

    try {
        action(element)
        cmd.ok("$verb '${selector.description}' ok", facts(verb, selector))
        return this
    } catch (e: Throwable) {
        if (optional) {
            val afterFailure =
                observe(
                    selector,
                    applyPreconditions = false,
                    suffix = "_after_action_failure",
                    predicate = { ElementState.probe(it, ElementState.Trait.DISPLAYED) },
                    via = via,
                )
            if (afterFailure.problem(selector) == null && afterFailure.matched == null) {
                cmd.skip(
                    "'${selector.description}' disappeared during $verb; skipped",
                    facts(
                        verb,
                        selector,
                        Failure.DISAPPEARED_DURING_ACTION,
                        extra = mapOf("actionThrowableType" to e::class.java.name),
                    ),
                )
                return this
            }
        }
        cmd.fail(
            "$verb '${selector.description}' failed: ${e.message ?: "exception"}",
            cause = e,
            facts = facts(verb, selector, Failure.ACTION_FAILED, expectation, dumpRef(dumpOnFailure, verb, selector)),
        )
        if (dumpOnFailure) dumpFailure("$verb failed: ${selector.description}")
        throw e
    }
}

/**
 * The inverse of [require]: assert [selector] is *not* on screen - now, or for the whole window.
 *
 * @return the receiver
 */
fun <T : VerbHost> T.requireAbsent(
    verb: String,
    selector: Selector,
    policy: WaitPolicy = WaitPolicy.Immediate,
    sustain: Boolean = false,
    dumpOnFailure: Boolean = false,
): T {
    val cmd = cmd(verb, selector.description, "Verifying '${selector.description}' is absent...")

    fun present(): Boolean {
        val observation =
            observe(
                selector,
                false,
                predicate = { ElementState.probe(it, ElementState.Trait.DISPLAYED) },
            )
        observation.problem(selector)?.let { failLookup(cmd, verb, selector, "absent", dumpOnFailure, it) }
        return observation.matched != null
    }

    val timeout = (policy as? WaitPolicy.Poll)?.timeout ?: 0
    val deadline = SystemClock.uptimeMillis() + timeout
    var wait = policy.firstGap()
    var appeared = present()
    // sustain: keep looking and fail on sight. Otherwise: keep looking until it is gone.
    while (appeared != sustain && SystemClock.uptimeMillis() < deadline) {
        SystemClock.sleep(wait)
        wait = (policy as WaitPolicy.Poll).next(wait)
        appeared = present()
    }

    if (appeared) {
        val message =
            when {
                sustain -> "'${selector.description}' was expected to stay absent but appeared within ${timeout}ms"
                timeout > 0 ->
                    "'${selector.description}' was expected to disappear but is still visible after ${timeout}ms"
                else -> "'${selector.description}' was expected to be absent but is visible"
            }
        cmd.fail(
            message,
            facts =
                facts(
                    verb,
                    selector,
                    if (sustain) Failure.APPEARED else Failure.STILL_PRESENT,
                    extra = dumpRef(dumpOnFailure, verb, selector),
                ),
        )
        if (dumpOnFailure) dumpFailure("$verb failed: ${selector.description}")
        throw AssertionError(message)
    }
    cmd.ok("'${selector.description}' absent", facts(verb, selector))
    return this
}

/**
 * Assert something about *all* the matches for a selector, rather than one of them.
 *
 * Only a Compose tag selector can produce a collection, which is the one fact worth reporting when a caller picks
 * another strategy.
 *
 * @return the receiver
 */
fun <T : VerbHost> T.requireAll(
    verb: String,
    selector: Selector,
    expectation: String,
    policy: WaitPolicy = WaitPolicy.Immediate,
    dumpOnFailure: Boolean = false,
    before: () -> Unit = {},
    satisfied: (SemanticsNodeInteractionCollection) -> Boolean,
    action: (SemanticsNodeInteractionCollection) -> Unit = {},
): T {
    val cmd = cmd(verb, selector.description, "Verifying '${selector.description}' $expectation...")
    before()

    val timeout = (policy as? WaitPolicy.Poll)?.timeout ?: 0
    val deadline = SystemClock.uptimeMillis() + timeout
    var wait = policy.firstGap()
    while (true) {
        val all = locateAll(selector)
        if (all == null) {
            val message = "${selector.strategy} cannot match more than one element; $verb needs a Compose tag selector"
            cmd.fail(message, facts = facts(verb, selector, Failure.UNSUPPORTED_STRATEGY, expectation))
            throw AssertionError(message)
        }
        if (runCatching { satisfied(all) }.getOrDefault(false)) {
            // Outside the runCatching above: a failing action is a real error to propagate, not a
            // "the expectation was false".
            action(all)
            cmd.ok("'${selector.description}' $expectation", facts(verb, selector, expectation = expectation))
            return this
        }
        if (SystemClock.uptimeMillis() >= deadline) break
        SystemClock.sleep(wait)
        wait = (policy as WaitPolicy.Poll).next(wait)
    }

    val message = "'${selector.description}' $expectation was false" + if (timeout > 0) " after ${timeout}ms" else ""
    cmd.fail(
        message,
        facts =
            facts(verb, selector, Failure.COLLECTION_UNSATISFIED, expectation, dumpRef(dumpOnFailure, verb, selector)),
    )
    if (dumpOnFailure) dumpFailure("$verb failed: ${selector.description}")
    throw AssertionError(message)
}

/**
 * Do [step] up to [attempts] times until [selector]'s presence matches [want].
 *
 * Checks first, acts second: if the screen is already how the caller wants it, nothing happens.
 *
 * @return the receiver
 */
fun <T : VerbHost> T.driveUntil(
    verb: String,
    selector: Selector,
    attempts: Int,
    want: Boolean,
    dumpOnFailure: Boolean = false,
    probe: (UiElement) -> Boolean = { ElementState.probe(it, ElementState.Trait.DISPLAYED) },
    settle: () -> Unit = {},
    step: () -> Unit,
): T {
    val goal = if (want) "present" else "gone"
    val cmd = cmd(verb, selector.description, "$verb until '${selector.description}' is $goal...")

    fun matches(attempt: Int): Boolean {
        val observation = observe(selector, false, "_attempt_$attempt", probe)
        observation.problem(selector)?.let { failLookup(cmd, verb, selector, goal, dumpOnFailure, it) }
        val here = observation.matched != null
        return here == want
    }

    for (attempt in 0..attempts) {
        if (matches(attempt + 1)) {
            cmd.ok("'${selector.description}' $goal after $attempt $verb(s)", facts(verb, selector))
            return this
        }
        if (attempt == attempts) break
        step()
        settle()
    }

    val message = "'${selector.description}' still not $goal after $attempts $verb(s)"
    cmd.fail(
        message,
        facts =
            facts(
                verb,
                selector,
                // "it never went away" and "it never showed up" are the same loop but not the same bug.
                if (want) Failure.NEVER_SETTLED else Failure.STILL_PRESENT,
                expectation = goal,
                extra = mapOf("attempts" to attempts) + dumpRef(dumpOnFailure, verb, selector),
            ),
    )
    if (dumpOnFailure) dumpFailure("$verb failed: ${selector.description}")
    throw AssertionError(message)
}

/**
 * Poll a condition with no selector behind it - the soft keyboard being up, a foreign package coming to the
 * foreground - with the same reporting and failure shape as the selector verbs.
 */
fun <T : VerbHost> T.requireState(
    verb: String,
    description: String,
    policy: WaitPolicy = WaitPolicy.Immediate,
    dumpOnFailure: Boolean = false,
    condition: () -> Boolean,
): T {
    val cmd = reporter().start(TimedReporter.Type.CMD, verb, "Verifying $description...")

    val timeout = (policy as? WaitPolicy.Poll)?.timeout ?: 0
    val deadline = SystemClock.uptimeMillis() + timeout
    var wait = policy.firstGap()
    while (true) {
        if (runCatching { condition() }.getOrDefault(false)) {
            cmd.ok("$description: yes", facts(verb))
            return this
        }
        if (SystemClock.uptimeMillis() >= deadline) break
        SystemClock.sleep(wait)
        wait = (policy as WaitPolicy.Poll).next(wait)
    }

    val message = if (timeout > 0) "$description: no, after ${timeout}ms" else "$description: no"
    cmd.fail(message, facts = facts(verb, failure = Failure.CONDITION_TIMEOUT, expectation = description))
    if (dumpOnFailure) dumpFailure(verb)
    throw AssertionError(message)
}

/**
 * Report around a [block] that already throws for itself.
 *
 * For the verbs that delegate to something else - a slider's semantics action, the notification shade,
 * AppAndSystemHelper's external-app assertions - where there is nothing to resolve and nothing to poll, only a call
 * whose failure should reach the report before it reaches the test.
 */
fun <T : VerbHost> T.reportAround(
    verb: String,
    description: String,
    dumpOnFailure: Boolean = false,
    block: () -> Unit,
): T {
    val cmd = cmd(verb, description, "$description...")
    try {
        block()
        cmd.ok("$description: done", facts(verb))
        return this
    } catch (e: Throwable) {
        cmd.fail(
            "$description failed: ${e.message ?: "exception"}",
            cause = e,
            facts = facts(verb, failure = Failure.ACTION_FAILED, expectation = description),
        )
        if (dumpOnFailure) dumpFailure("$verb failed: $description")
        throw e
    }
}

/**
 * Are all of [selectors] on screen? Reports each one, answers rather than throwing. One command in the report however
 * long the wait, not one per tick.
 *
 * @return true when every selector is present before the policy expires
 */
fun VerbHost.groupPresent(
    verb: String,
    label: String,
    selectors: List<Selector>,
    policy: WaitPolicy = WaitPolicy.Immediate,
    applyPreconditions: Boolean = false,
    whenPresent: String = "'$label' present",
): Boolean {
    val cmd = cmd(verb, label, "Checking '$label'...")
    if (selectors.isEmpty()) {
        cmd.fail(
            "'$label' has no selectors",
            facts = facts(verb, failure = Failure.EMPTY_SELECTOR_GROUP, extra = mapOf("group" to label)),
        )
        return false
    }

    var lastRetryableProblem: Pair<Selector, LookupProblem>? = null
    fun allPresent(): Boolean {
        lastRetryableProblem = null
        return selectors.all { sel ->
            val observation =
                observe(
                    sel,
                    applyPreconditions,
                    "_in_$label",
                    predicate = { ElementState.probe(it, ElementState.Trait.DISPLAYED) },
                )
            observation.problem(sel)?.let { problem ->
                if (!problem.retryable) {
                    failLookup(cmd, verb, sel, "present", dumpOnFailure = false, problem)
                }
                lastRetryableProblem = sel to problem
            }
            observation.matched != null
        }
    }

    val timeout = (policy as? WaitPolicy.Poll)?.timeout ?: 0
    val deadline = SystemClock.uptimeMillis() + timeout
    var wait = policy.firstGap()
    var here = allPresent()
    if (!here && lastRetryableProblem != null && dismissOverlays()) {
        here = allPresent()
    }
    while (!here && SystemClock.uptimeMillis() < deadline) {
        SystemClock.sleep(wait)
        wait = (policy as WaitPolicy.Poll).next(wait)
        here = allPresent()
    }

    if (!here && dismissOverlays()) {
        here = allPresent()
    }

    if (!here && policy is WaitPolicy.Poll) {
        lastRetryableProblem?.let { (selector, problem) ->
            failLookup(cmd, verb, selector, "present", dumpOnFailure = false, problem)
        }
    }

    cmd.done(
        here,
        if (here) whenPresent else "'$label' not present",
        facts(verb, failure = if (here) null else Failure.NOT_ARRIVED, extra = mapOf("page" to label)),
    )
    return here
}

/**
 * Which screen dump belongs to this failure. [dumpFailure] labels its output; recording the same label here is what
 * lets a consumer pair the two up, since the dump goes to logcat under its own tag and carries no step id of its own.
 */
private fun dumpRef(dumping: Boolean, verb: String, selector: Selector): Map<String, Any?> =
    if (dumping) mapOf("dump" to "$verb failed: ${selector.description}") else emptyMap()

/**
 * What a lookup saw: [located] is the element if it resolved at all, [matched] only if it also satisfied the predicate.
 * Two fields rather than one nullable so a failure can say which happened.
 */
private class Probe(
    val located: UiElement? = null,
    val matched: UiElement? = null,
    val last: Observation,
)

private data class Observation(
    val resolution: ElementResolution,
    val matched: UiElement? = null,
    val phase: String = "resolve",
)

private data class LookupProblem(
    val failure: String,
    val message: String,
    val cause: Throwable? = null,
    val phase: String,
    val retryable: Boolean = false,
)

/**
 * The lookup itself: poll if asked, and give a covering overlay exactly one chance to be dismissed before declaring the
 * target absent.
 */
private fun VerbHost.seek(
    selector: Selector,
    policy: WaitPolicy,
    applyPreconditions: Boolean,
    predicate: (UiElement) -> Boolean,
    via: ((Selector, Boolean) -> ElementResolution)? = null,
): Probe {
    var seen: UiElement? = null

    fun once(): Observation {
        val observation = observe(selector, applyPreconditions, predicate = predicate, via = via)
        (observation.resolution as? ElementResolution.Found)?.element?.let { seen = it }
        return observation
    }

    var observation = once()
    if (observation.matched == null && observation.problem(selector)?.retryable == true && dismissOverlays()) {
        observation = once()
    }
    if (
        observation.matched == null &&
            observation.problem(selector)?.let { !it.retryable } != true &&
            policy is WaitPolicy.Poll
    ) {
        val deadline = SystemClock.uptimeMillis() + policy.timeout
        var wait = policy.firstGap()
        while (
            observation.matched == null &&
                observation.problem(selector)?.let { !it.retryable } != true &&
                SystemClock.uptimeMillis() < deadline
        ) {
            SystemClock.sleep(wait)
            wait = policy.next(wait)
            observation = once()
        }
    }
    // A known blocking overlay may have been covering the target the whole time.
    if (
        observation.matched == null && observation.problem(selector)?.let { !it.retryable } != true && dismissOverlays()
    ) {
        observation = once()
    }
    return Probe(seen, observation.matched, observation)
}

private fun VerbHost.observe(
    selector: Selector,
    applyPreconditions: Boolean,
    suffix: String = "",
    predicate: (UiElement) -> Boolean,
    via: ((Selector, Boolean) -> ElementResolution)? = null,
): Observation {
    val loc = loc(selector.description, suffix)
    val resolution =
        try {
            via?.invoke(selector, applyPreconditions) ?: locate(selector, applyPreconditions)
        } catch (e: Throwable) {
            ElementResolution.Error(e)
        }
    return when (resolution) {
        is ElementResolution.Found ->
            try {
                if (predicate(resolution.element)) {
                    loc.found(
                        selector.description,
                        true,
                        facts("locate", selector, extra = mapOf("resolution" to "found")),
                    )
                    Observation(resolution, resolution.element)
                } else {
                    loc.fail(
                        "'${selector.description}' found but predicate was false",
                        facts =
                            facts(
                                "locate",
                                selector,
                                Failure.WRONG_STATE,
                                extra = mapOf("resolution" to "found"),
                            ),
                    )
                    Observation(resolution)
                }
            } catch (e: Throwable) {
                loc.fail(
                    "'${selector.description}' predicate failed: ${e.message ?: "exception"}",
                    cause = e,
                    facts =
                        facts(
                            "locate",
                            selector,
                            Failure.PREDICATE_ERROR,
                            extra = mapOf("resolution" to "error", "failurePhase" to "predicate"),
                        ),
                )
                Observation(ElementResolution.Error(e), phase = "predicate")
            }
        ElementResolution.Absent -> {
            loc.found(
                selector.description,
                false,
                facts("locate", selector, Failure.NOT_FOUND, extra = mapOf("resolution" to "absent")),
            )
            Observation(resolution)
        }
        is ElementResolution.Unsupported -> {
            loc.fail(
                "'${selector.description}' is unsupported: ${resolution.reason}",
                facts =
                    facts(
                        "locate",
                        selector,
                        Failure.UNSUPPORTED_STRATEGY,
                        extra = mapOf("resolution" to "unsupported", "reason" to resolution.reason),
                    ),
            )
            Observation(resolution)
        }
        is ElementResolution.Error -> {
            val details =
                facts(
                    "locate",
                    selector,
                    Failure.RESOLUTION_ERROR,
                    extra =
                        mapOf(
                            "resolution" to if (resolution.retryable) "transient_error" else "error",
                            "failurePhase" to "resolve",
                            "retryable" to resolution.retryable,
                        ),
                )
            if (resolution.retryable) {
                loc.found(selector.description, false, details)
            } else {
                loc.fail(
                    "'${selector.description}' resolution failed: ${resolution.cause.message ?: "exception"}",
                    cause = resolution.cause,
                    facts = details,
                )
            }
            Observation(resolution)
        }
    }
}

private fun Observation.problem(selector: Selector): LookupProblem? =
    when (val result = resolution) {
        is ElementResolution.Unsupported ->
            LookupProblem(
                Failure.UNSUPPORTED_STRATEGY,
                "'${selector.description}' is unsupported: ${result.reason}",
                phase = phase,
            )
        is ElementResolution.Error ->
            LookupProblem(
                if (phase == "predicate") Failure.PREDICATE_ERROR else Failure.RESOLUTION_ERROR,
                "'${selector.description}' $phase failed: ${result.cause.message ?: "exception"}",
                result.cause,
                phase,
                result.retryable,
            )
        else -> null
    }

private fun VerbHost.failLookup(
    scope: TimedReporter.Scope,
    verb: String,
    selector: Selector,
    expectation: String,
    dumpOnFailure: Boolean,
    problem: LookupProblem,
): Nothing {
    scope.fail(
        problem.message,
        cause = problem.cause,
        facts =
            facts(
                verb,
                selector,
                problem.failure,
                expectation,
                mapOf("failurePhase" to problem.phase) + dumpRef(dumpOnFailure, verb, selector),
            ),
    )
    if (dumpOnFailure) dumpFailure("$verb failed: ${selector.description}")
    problem.cause?.let { throw it }
    throw AssertionError(problem.message)
}
