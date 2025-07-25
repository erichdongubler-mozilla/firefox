/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.settings.search

import android.content.Context
import android.content.res.Resources
import android.util.AttributeSet
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.CompoundButton
import android.widget.LinearLayout
import android.widget.RadioGroup
import androidx.core.graphics.drawable.toDrawable
import androidx.core.view.isVisible
import androidx.navigation.findNavController
import androidx.preference.Preference
import androidx.preference.PreferenceViewHolder
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import mozilla.components.browser.state.search.SearchEngine
import mozilla.components.browser.state.state.SearchState
import mozilla.components.browser.state.state.searchEngines
import mozilla.components.browser.state.state.selectedOrDefaultSearchEngine
import mozilla.components.browser.state.store.BrowserStore
import mozilla.components.lib.state.ext.flow
import mozilla.components.support.ktx.android.view.toScope
import org.mozilla.fenix.GleanMetrics.Events
import org.mozilla.fenix.R
import org.mozilla.fenix.databinding.SearchEngineRadioButtonBinding
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.ext.telemetryName

class RadioSearchEngineListPreference @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = android.R.attr.preferenceStyle,
) : Preference(context, attrs, defStyleAttr), CompoundButton.OnCheckedChangeListener {
    private val itemResId: Int
        get() = R.layout.search_engine_radio_button

    init {
        layoutResource = R.layout.preference_search_engine_chooser
    }

    override fun onBindViewHolder(holder: PreferenceViewHolder) {
        super.onBindViewHolder(holder)

        subscribeToSearchEngineUpdates(
            context.components.core.store,
            holder.itemView,
        )
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun subscribeToSearchEngineUpdates(store: BrowserStore, view: View) = view.toScope().launch {
        store.flow()
            .map { state -> state.search }
            .distinctUntilChanged()
            .collect { state -> refreshSearchEngineViews(view, state) }
    }

    private fun refreshSearchEngineViews(view: View, state: SearchState) {
        val searchEngineGroup = view.findViewById<RadioGroup>(R.id.search_engine_group)
        searchEngineGroup!!.removeAllViews()

        val layoutInflater = LayoutInflater.from(context)
        val layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )

        state.searchEngines.filter { engine ->
            engine.type != SearchEngine.Type.APPLICATION
        }.forEach { engine ->
            val searchEngineView = makeButtonFromSearchEngine(
                engine = engine,
                layoutInflater = layoutInflater,
                res = context.resources,
                allowDeletion = engine.type == SearchEngine.Type.CUSTOM,
                isSelected = engine == state.selectedOrDefaultSearchEngine,
            )

            searchEngineGroup.addView(searchEngineView, layoutParams)
        }
    }

    private fun makeButtonFromSearchEngine(
        engine: SearchEngine,
        layoutInflater: LayoutInflater,
        res: Resources,
        allowDeletion: Boolean,
        isSelected: Boolean,
    ): View {
        val isCustomSearchEngine = engine.type == SearchEngine.Type.CUSTOM

        val wrapper = layoutInflater.inflate(itemResId, null) as LinearLayout

        val binding = SearchEngineRadioButtonBinding.bind(wrapper)

        wrapper.setOnClickListener { binding.radioButton.isChecked = true }

        binding.radioButton.tag = engine.id
        binding.radioButton.isChecked = isSelected
        binding.radioButton.setOnCheckedChangeListener(this)
        binding.engineText.text = engine.name
        binding.overflowMenu.isVisible = allowDeletion || isCustomSearchEngine
        binding.overflowMenu.setOnClickListener {
            SearchEngineMenu(
                context = context,
                allowDeletion = allowDeletion,
                isCustomSearchEngine = isCustomSearchEngine,
                onItemTapped = {
                    when (it) {
                        is SearchEngineMenu.Item.Edit -> editCustomSearchEngine(wrapper, engine)
                        is SearchEngineMenu.Item.Delete -> deleteSearchEngine(
                            context,
                            engine,
                        )
                    }
                },
            ).menuBuilder.build(context).show(binding.overflowMenu)
        }
        val iconSize = res.getDimension(R.dimen.preference_icon_drawable_size).toInt()
        val engineIcon = engine.icon.toDrawable(res)
        engineIcon.setBounds(0, 0, iconSize, iconSize)
        binding.engineIcon.setImageDrawable(engineIcon)
        return wrapper
    }

    override fun onCheckedChanged(buttonView: CompoundButton, isChecked: Boolean) {
        val searchEngineId = buttonView.tag.toString()
        val engine = requireNotNull(
            context.components.core.store.state.search.searchEngines.find { searchEngine ->
                searchEngine.id == searchEngineId
            },
        )

        context.components.useCases.searchUseCases.selectSearchEngine(engine)

        Events.defaultEngineSelected.record(Events.DefaultEngineSelectedExtra(engine.telemetryName()))
    }

    private fun editCustomSearchEngine(view: View, engine: SearchEngine) {
        val directions =
            DefaultSearchEngineFragmentDirections
                .actionDefaultEngineFragmentToSaveSearchEngineFragment(engine.id)
        view.findNavController().navigate(directions)
    }

    private fun deleteSearchEngine(
        context: Context,
        engine: SearchEngine,
    ) {
        val selectedOrDefaultSearchEngine = context.components.core.store.state.search.selectedOrDefaultSearchEngine
        if (selectedOrDefaultSearchEngine == engine) {
            val nextSearchEngine =
                context.components.core.store.state.search.searchEngines.firstOrNull {
                    it.id != engine.id && (it.isGeneral || it.type == SearchEngine.Type.CUSTOM)
                }
                    ?: context.components.core.store.state.search.searchEngines.firstOrNull {
                        it.id != engine.id
                    }

            nextSearchEngine?.let {
                context.components.useCases.searchUseCases.selectSearchEngine(
                    nextSearchEngine,
                )
            }
        }
        context.components.useCases.searchUseCases.removeSearchEngine(engine)
    }
}
