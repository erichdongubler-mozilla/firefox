/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.ui.efficiency.navigation

data class NavigationEdge(
    val from: String,
    val to: String,
    val steps: List<NavigationStep>,
    val launch: LaunchConfig? = null,
    val variant: String? = null,
    val purpose: NavigationRoutePurpose = NavigationRoutePurpose.SETUP,
    val requires: Set<NavigationFact> = emptySet(),
    val forbids: Set<NavigationFact> = emptySet(),
    val provides: Set<NavigationFact> = emptySet(),
    val invalidates: Set<NavigationFact> = emptySet(),
    val traits: Set<NavigationRouteTrait> = emptySet(),
) {
    val id: String
        get() = listOfNotNull("$from->$to", variant).joinToString("#")

    fun canTraverse(facts: Set<NavigationFact>): Boolean = requires.all { it in facts } && forbids.none { it in facts }

    fun traverse(state: NavigationState): NavigationState {
        require(state.page == from) {
            "Cannot traverse '$id' from '${state.page}'"
        }
        require(canTraverse(state.facts)) {
            "Navigation state ${state.facts} does not satisfy '$id'"
        }

        return NavigationState(
                page = to,
                facts = (state.facts - invalidates) + provides,
            )
            .normalized()
    }
}

enum class NavigationRoutePurpose {
    SETUP,
    COVERAGE,
}
