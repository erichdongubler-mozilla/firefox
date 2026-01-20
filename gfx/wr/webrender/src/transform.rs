use api::units::{LayoutToPictureTransform, PicturePixel, PictureToLayoutTransform};
use crate::{FastHashMap, frame_allocator::FrameMemory, gpu_types::VECS_PER_TRANSFORM};
use crate::internal_types::FrameVec;
use crate::spatial_tree::{SpatialNodeIndex, SpatialTree};
use crate::util::{TransformedRectKind, MatrixHelpers};

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/// Represents the information about a transform palette
/// entry that is passed to shaders. It includes an index
/// into the transform palette, and a set of flags. The
/// only flag currently used determines whether the
/// transform is axis-aligned (and this should have
/// pixel snapping applied).
#[derive(Copy, Debug, Clone, PartialEq)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
#[repr(C)]
pub struct GpuTransformId(pub u32);

impl GpuTransformId {
    /// Identity transform ID.
    pub const IDENTITY: Self = GpuTransformId(0);

    /// Extract the transform kind from the id.
    pub fn transform_kind(&self) -> TransformedRectKind {
        if (self.0 >> 23) == 0 {
            TransformedRectKind::AxisAligned
        } else {
            TransformedRectKind::Complex
        }
    }

    /// Override the kind of transform stored in this id. This can be useful in
    /// cases where we don't want shaders to consider certain transforms axis-
    /// aligned (i.e. perspective warp) even though we may still want to for the
    /// general case.
    pub fn override_transform_kind(&self, kind: TransformedRectKind) -> Self {
        GpuTransformId((self.0 & 0x7FFFFFu32) | ((kind as u32) << 23))
    }
}

/// The GPU data payload for a transform palette entry.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
#[repr(C)]
pub struct TransformData {
    transform: LayoutToPictureTransform,
    inv_transform: PictureToLayoutTransform,
}

impl TransformData {
    fn invalid() -> Self {
        TransformData {
            transform: LayoutToPictureTransform::identity(),
            inv_transform: PictureToLayoutTransform::identity(),
        }
    }
}

// Extra data stored about each transform palette entry.
#[derive(Clone)]
pub struct TransformMetadata {
    transform_kind: TransformedRectKind,
}

impl TransformMetadata {
    pub fn invalid() -> Self {
        TransformMetadata {
            transform_kind: TransformedRectKind::AxisAligned,
        }
    }
}

#[derive(Debug, Hash, Eq, PartialEq)]
struct RelativeTransformKey {
    from_index: SpatialNodeIndex,
    to_index: SpatialNodeIndex,
}

pub struct TransformPalette {
    pub gpu: GpuTransforms,
}

impl TransformPalette {
    pub fn new(
        count: usize,
        memory: &FrameMemory,
    ) -> Self {
        TransformPalette {
            gpu: GpuTransforms::new(count, memory),
        }
    }

    pub fn finish(self) -> FrameVec<TransformData> {
        self.gpu.finish()
    }
}

// Stores a contiguous list of TransformData structs, that
// are ready for upload to the GPU.
// TODO(gw): For now, this only stores the complete local
//           to world transform for each spatial node. In
//           the future, the transform palette will support
//           specifying a coordinate system that the transform
//           should be relative to.
pub struct GpuTransforms {
    transforms: FrameVec<TransformData>,
    metadata: Vec<TransformMetadata>,
    map: FastHashMap<RelativeTransformKey, usize>,
}

impl GpuTransforms {
    fn new(
        count: usize,
        memory: &FrameMemory,
    ) -> Self {
        let _ = VECS_PER_TRANSFORM;

        let mut transforms = memory.new_vec_with_capacity(count);
        let mut metadata = Vec::with_capacity(count);

        transforms.push(TransformData::invalid());
        metadata.push(TransformMetadata::invalid());

        GpuTransforms {
            transforms,
            metadata,
            map: FastHashMap::default(),
        }
    }

    fn finish(self) -> FrameVec<TransformData> {
        self.transforms
    }

    fn get_index(
        &mut self,
        child_index: SpatialNodeIndex,
        parent_index: SpatialNodeIndex,
        spatial_tree: &SpatialTree,
    ) -> usize {
        if child_index == parent_index {
            0
        } else {
            let key = RelativeTransformKey {
                from_index: child_index,
                to_index: parent_index,
            };

            let metadata = &mut self.metadata;
            let transforms = &mut self.transforms;

            *self.map
                .entry(key)
                .or_insert_with(|| {
                    let transform = spatial_tree.get_relative_transform(
                        child_index,
                        parent_index,
                    )
                    .into_transform()
                    .with_destination::<PicturePixel>();

                    register_gpu_transform(
                        metadata,
                        transforms,
                        transform,
                    )
                })
        }
    }

    // Get a transform palette id for the given spatial node.
    // TODO(gw): In the future, it will be possible to specify
    //           a coordinate system id here, to allow retrieving
    //           transforms in the local space of a given spatial node.
    pub fn get_id(
        &mut self,
        from_index: SpatialNodeIndex,
        to_index: SpatialNodeIndex,
        spatial_tree: &SpatialTree,
    ) -> GpuTransformId {
        let index = self.get_index(
            from_index,
            to_index,
            spatial_tree,
        );
        let transform_kind = self.metadata[index].transform_kind as u32;
        GpuTransformId(
            (index as u32) |
            (transform_kind << 23)
        )
    }

    pub fn get_custom(
        &mut self,
        transform: LayoutToPictureTransform,
    ) -> GpuTransformId {
        let index = register_gpu_transform(
            &mut self.metadata,
            &mut self.transforms,
            transform,
        );

        let transform_kind = self.metadata[index].transform_kind as u32;
        GpuTransformId(
            (index as u32) |
            (transform_kind << 23)
        )
    }
}

// Set the local -> world transform for a given spatial
// node in the transform palette.
fn register_gpu_transform(
    metadatas: &mut Vec<TransformMetadata>,
    transforms: &mut FrameVec<TransformData>,
    transform: LayoutToPictureTransform,
) -> usize {
    // TODO: refactor the calling code to not even try
    // registering a non-invertible transform.
    let inv_transform = transform
        .inverse()
        .unwrap_or_else(PictureToLayoutTransform::identity);

    let metadata = TransformMetadata {
        transform_kind: transform.transform_kind()
    };
    let data = TransformData {
        transform,
        inv_transform,
    };

    let index = transforms.len();
    metadatas.push(metadata);
    transforms.push(data);

    index
}
