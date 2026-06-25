/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Classic TopSites drag-and-drop — pure mechanics over a caller-built list.
// Movability rules, the persisted action, and telemetry are all injected, so
// nothing domain- or store-shaped lives in here.
export function useTopSitesDnD({
  baseSites,
  rows,
  isMovable, // site flows into the free pool
  isShiftable, // anchored site that slides to make room
  onDragStart,
  onReorder, // ({ site, title, fromIndex, toIndex }) — caller persists it
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [draggedSite, setDraggedSite] = useState(null);
  const [draggedTitle, setDraggedTitle] = useState(null);
  const [previewSites, setPreviewSites] = useState(null);
  // Set on drop so the trailing dragend doesn't reset us.
  const droppedRef = useRef(false);

  const resetDrag = useCallback(() => {
    setDraggedIndex(null);
    setDraggedSite(null);
    setDraggedTitle(null);
    setPreviewSites(null);
  }, []);

  // The list as it'd look after dropping at `index`: anchors hold their spot
  // (shiftable ones slide to make room), movable tiles refill the holes.
  const makeTopSitesPreview = useCallback(
    index => {
      const sites = baseSites.slice(); // shared — don't mutate in place
      sites[draggedIndex] = null;
      const preview = sites.map(site =>
        site && !isMovable(site) ? site : null
      );
      const pool = sites.filter(site => site && isMovable(site));
      const siteToInsert = Object.assign({}, draggedSite, {
        isPinned: true,
        isDragged: true,
      });

      if (!preview[index]) {
        preview[index] = siteToInsert;
      } else {
        // Shift anchors toward the hole the dragged tile left.
        let holeIndex = index;
        const indexStep = index > draggedIndex ? -1 : 1;
        while (preview[holeIndex]) {
          holeIndex += indexStep;
        }
        const shiftingStep = index > draggedIndex ? 1 : -1;
        while (index > draggedIndex ? holeIndex < index : holeIndex > index) {
          let nextIndex = holeIndex + shiftingStep;
          // Skip fixed anchors — they don't move.
          while (
            preview[nextIndex] &&
            !isMovable(preview[nextIndex]) &&
            !isShiftable(preview[nextIndex])
          ) {
            nextIndex += shiftingStep;
          }
          preview[holeIndex] = preview[nextIndex];
          holeIndex = nextIndex;
        }
        preview[index] = siteToInsert;
      }

      for (let i = 0; i < preview.length; i++) {
        if (!preview[i]) {
          preview[i] = pool.shift() || null;
        }
      }

      return preview;
    },
    [baseSites, draggedIndex, draggedSite, isMovable, isShiftable]
  );

  const onDragEvent = useCallback(
    (event, index, link, title) => {
      switch (event.type) {
        case "dragstart":
          droppedRef.current = false;
          setDraggedIndex(index);
          setDraggedSite(link);
          setDraggedTitle(title);
          onDragStart?.(index);
          break;
        case "dragend":
          if (!droppedRef.current) {
            resetDrag();
          }
          break;
        case "dragenter":
          if (index === draggedIndex) {
            setPreviewSites(null);
          } else {
            setPreviewSites(makeTopSitesPreview(index));
          }
          break;
        case "drop":
          if (index !== draggedIndex) {
            droppedRef.current = true;
            onReorder?.({
              site: draggedSite,
              title: draggedTitle,
              fromIndex: draggedIndex,
              toIndex: index,
            });
          }
          break;
      }
    },
    [
      draggedIndex,
      draggedSite,
      draggedTitle,
      makeTopSitesPreview,
      onDragStart,
      onReorder,
      resetDrag,
    ]
  );

  // Clear the drag once the committed order arrives (the dragged url left its
  // old slot). Layout effect so the preview doesn't flash first.
  const prevRowsRef = useRef(rows);
  useLayoutEffect(() => {
    const prevRows = prevRowsRef.current;
    if (
      draggedSite &&
      prevRows &&
      prevRows[draggedIndex] &&
      prevRows[draggedIndex].url === draggedSite.url &&
      (!rows[draggedIndex] || rows[draggedIndex].url !== draggedSite.url)
    ) {
      resetDrag();
    }
    prevRowsRef.current = rows;
  }, [rows, draggedSite, draggedIndex, resetDrag]);

  return { previewSites, onDragEvent, draggedSite };
}
