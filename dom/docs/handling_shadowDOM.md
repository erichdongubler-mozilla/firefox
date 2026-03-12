# Handling shadow DOM in the various tree kinds

## Flattened tree

Flattened tree is defined in
[CSS Shadow Module Level 1](https://drafts.csswg.org/css-shadow-1/#flattening).

## Shadow host

It is an `Element` node which has a `ShadowRoot` attached to it. In the
flattened tree, its children are treated as replaced with the children of the
`ShadowRoot`. So, the children of `ShadowRoot` look like the children of the
host in the flattened tree
([spec](https://dom.spec.whatwg.org/#element-shadow-host)).

`nsINode` APIs, such as `nsINode::GetChildAt<TreeKind>()`,
`nsINode::GetChildCount<TreeKind>()` and `nsINode::ComputeIndexOf<TreeKind>()`,
treat the children of `ShadowRoot` as the children of host if `TreeKind` is not
[`TreeKind::DOM`](#treekinddom).

## ShadowRoot

It is a content node, inherits `DocumentFragment`. Therefore, when you print
inclusive ancestors of a node in a `ShadowRoot` with `ToString(*node).c_str()`,
you'll see `#document-fragment` as the root node
([spec](https://dom.spec.whatwg.org/#concept-shadow-root)).

In the flattened tree, the children of a `ShadowRoot` are formatted as children
of the [shadow host](#shadow-host) and the children of the shadow host are not
part of the flattened tree unless they are assigned to `<slot>` elements.

When comparing attached `ShadowRoot` and a child of the shadow host element,
`ShadowRoot` is treated as before the first child of the host.

## HTMLSlotElement

When it appears in a shadow DOM, it may have assigned nodes which are children
of the host element. In the flattened tree, the assigned nodes of a `<slot>`
element are formatted as its children and the children of the `<slot>` are not
part of the flattened tree
([spec](https://html.spec.whatwg.org/#the-slot-element)). However, if a
`<slot>` does not have assigned node, the element is treated as a usual
container element because they are the fallback content of the element when
there are no assigned nodes.

`nsINode::GetParentOrShadowHostNode<TreeKind>()` for
`TreeKind::FlatForSelection` and `TreeKind::Flat` of a `<slot>` element which
has some assigned nodes return the `<slot>` element as the parent node.
However, with the other `TreeKind`s, it returns the parent node in the shadow
including DOM.

Similarly, `nsINode::GetChildAt<TreeKind>()`,
`nsINode::GetChildCount<TreeKind>()` and `nsINode::ComputeIndexOf<TreeKind>()`
for `TreeKind::FlatForSelection` and `TreeKind::Flat` of a `<slot>` which has
some assigned nodes treat the assigned nodes as children of the `<slot>`.

Note that the assigned nodes are not treated as in the shadow tree by
`nsINode::IsInShadowTree()`. So, it returns `false` for the assigned nodes if
they are not a descendant of a `ShadowRoot`.

## UA shadow tree

Gecko attaches internally created `ShadowRoot` to some specific elements.
For example, `<details>`, `<video>` and SVG `<use>`. You can check it with
`ShadowRoot::IsContentShadowRoot()` (returning `false` means it's a UA shadow's
`ShadowRoot`). Often the children of the UA shadow host element will be assigned
to one or more `<slot>`s in the shadow. Therefore, they can be selected by the
user. Additionally, Selection API can specify any points in the host element as
a range boundary. However, from the shadow including DOM point of view, children
should be treated as replaced by the children of the UA `ShadowRoot`. Therefore,
when we handle selection including DOM ranges, we need to ignore the UA shadow.

## Kinds of DOM tree

To support the shadow DOM, there are 4 kinds of DOM trees which are identified
with `TreeKind` defined in `nsINode.h`.

### TreeKind::DOM

The simplest DOM tree which do not treat `ShadowRoot` attached to an element.

`nsINode::GetChildAt<TreeKind::DOM>()`,
`nsINode::GetChildCount<TreeKind::DOM>()` and
`nsINode::ComputeIndexOf<TreeKind::DOM>()` treat the children of any nodes
as-is.

`nsINode::GetParentNode<TreeKind::DOM>()` returns the parent node
as-is. If you call it of a `ShadowRoot`, it returns `nullptr`.

### TreeKind::ShadowIncludingDOM

This is not standardized. However, there are some points in the spec mentioned
about
["shadow-including tree"](https://dom.spec.whatwg.org/#concept-shadow-including-tree-order).

A [shadow host element](#shadow-host) treats the attached `ShadowRoot` as
connected to its host (before the first child). However, `<slot>` elements are
not handled, they are always treated as usual container element.

A notable thing about this `TreeKind` is, the children of the host element
are also treated as its children as-is.

`nsINode::GetChildAt<TreeKind::ShadowIncludingDOM>()`,
`nsINode::GetChildCount<TreeKind::ShadowIncludingDOM>` and
`nsINode::ComputeIndexOf<TreeKind::ShadowIncludingDOM>()` are not available
because it's unclear that whether they will handle the children of the host
or the `ShadowRoot`. Therefore, you need to use `TreeKind::DOM` APIs of
a shadow host or its `ShadowRoot` explicitly.

`nsINode::GetParentNode<TreeKind::ShadowIncludingDOM>()` is not available
because it's unclear that whether it will return `ShadowRoot` or its host
when the node is a child of `ShadowRoot`. Therefore, you need to use
`TreeKind::DOM` API of the child or if you need to get host as a parent of a
`ShadowRoot`, you can use `nsINode::GetParentOrShadowHostNode()`.

Note that the [UA shadow tree](#ua-shadow-tree)s are ignored when reaching the
shadow DOM boundary. Therefore, the UA shadow host element is treated as same
as not hosting the shadow.

### TreeKind::FlatForSelection

Handle [the flattened tree](#flattened-tree) except formatting the
[UA shadow tree](#ua-shadow-tree)s. The assigned nodes of `<slot>` elements are
treated as children of the `<slot>` element (if a `<slot>` does not have
assigned node, it's treated as a normal element which may have some children).

`nsINode::GetChildAt<TreeKind::FlatForSelection>()`,
`nsINode::GetChildCount<TreeKind::FlatForSelection>()` and
`nsINode::ComputeIndexOf<TreeKind::FlatForSelection()` of a `<slot>` which has
some assigned nodes treat the assigned nodes as the children of the `<slot>`.

`nsINode::GetChildAt<TreeKind::FlatForSelection>()`,
`nsINode::GetChildCount<TreeKind::FlatForSelection>()` and
`nsINode::ComputeIndexOf<TreeKind::FlatForSelection()` of a
[shadow host](#shadow-host) treat the shadow root children as the children.

`nsINode::GetParentNode<TreeKind::FlatForSelection>()` of an assigned node of
a `<slot>` returns the `<slot>` element.

`nsINode::GetParentNode<TreeKind::FlatForSelection>()` of a child of a
[ShadowRoot](#shadowroot) returns the host. So, `ShadowRoot` is ignored.

`nsINode::GetParentNode<TreeKind::FlatForSelection>()` of a
[ShadowRoot](#shadowroot) returns `nullptr`.

The [UA shadow tree](#ua-shadow-tree)s are ignored too. Similarly, when you
handle a `<slot>` element which has some assigned nodes, the APIs for
`TreeKind::FlatForSelection` check whether the `<slot>`'s `ShadowRoot` is a UA
one. If it's so, the `<slot>` element is treated as a usual container element.

When you call `nsINode::GetParentNode<TreeKind::FlatForSelection>()` of a child
of a `<slot>` which has some assigned nodes, it'll return the parent node in
`TreeKind::DOM`. This behavior is different from `TreeKind::Flat` and odd.
This should be fixed in
[bug 2014622](https://bugzilla.mozilla.org/show_bug.cgi?id=2014622).

### TreeKind::Flat

Almost same as `TreeKind::FlatForSelection`. Additionally, the
[UA shadow tree](#ua-shadow-tree)s won't be ignored. Thus, you can handle all
things which aren't bound to a UA shadow tree.

When you call `nsINode::GetParentNode<TreeKind::Flat>()` on a child of a
`<slot>` which has some assigned nodes, it'll return `nullptr` because the node
is not a part of the [flattened tree](#flattened-tree).

## Iterating children of a node

The children of [Shadow host element](#shadow-host) may not a part of
[the flattened tree](#flattened-tree) or assigned to a `<slot>` in the shadow.
Therefore, it may not be cheap to get the siblings of a child node in the
flattened tree. Therefore, `nsINode::GetFlattenedTreeNextSibling()` etc are not
available to make the developers realize the cost.

To handle multiple siblings, there is a useful template iterator class,
`ChildIterBase<TreeKind>`. There are alias names for each `TreeKind`. (To
lead the developers to this template class, there are the deleted `nsINode`
API declarations.)

| `TreeKind` | `ChildIterBase<TreeKind>` |
| ---------- | ------------------------- |
| `TreeKind::DOM` | `ChildIterator` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `FlattenedChildIteratorForSelection` |
| `TreeKind::Flat` | `FlattenedChildIterator` |

You can initialize them with a parent node.

```cpp
ChildIterBase<aKind> iter(parentNode);
```

Then, if you need to iterate from a specific child rather than from the first
child, you need to seek the child.

```cpp
if (!iter.Seek(childNode)) {
  return; // childNode is not a child of parentNode in the specified tree.
}
```

Then, you can iterate the remaining children:
```cpp
for (nsIContent* sibling = iter.GetNextChild(); sibling;
     sibling = iter.GetNextChild()) {
  // Do something with sibling.
}
```
```cpp
for (nsIContent* sibling = iter.GetPreviousChild(); sibling;
     sibling = iter.GetPreviousChild()) {
  // Do something with sibling.
}
```

## Comparing points

`nsContentUtils::ComparePoints` and `nsContentUtils::ComparePointsWithIndices()`
are template methods whose template parameter is `TreeKind`.

If `TreeKind` is `DOM`, the points in different shadow trees are treated as
disconnected. Otherwise, the points are compared across the shadow DOM
boundaries.

Even if the `TreeKind` of the template method is `ShadowIncludingDOM`, the
points can be the points in the flattened tree. Similarly, even if the
`TreeKind` is `FlatForSelection`, the points can be the points in the DOM.
Using different `TreeKind` points are not recommended, but works in the most
cases. However, to prevent a bug in an edge case, you should convert the
points to `TreeKind::DOM` if you use `TreeKind::ShadowIncludingDOM` method and
convert the points to `TreeKind::FlatForSelection` or `TreeKind::Flat` when you
use the corresponding method.

(Probably, we should stop allowing different `TreeKind` range boundaries as
the parameters of `nsContentUtils::ComparePoints`.)

## Convert a point in `TreeKind::DOM` or `TreeKind::FlatForSelection` to the other

`RangeBoundaryBase` supports `TreeKind::DOM` and `TreeKind::FlatForSelection`
and it has factory methods to create the instance in those kinds of tree.
Use `AsRangeBoundaryInDOMTree()` to get a point in `TreeKind::DOM` and use
`AsRangeBoundaryInFlatTree()` to get a point in `TreeKind::FlatForSelection`.
If the referring child node has different parent in the trees, these methods
compute the proper parent automatically.

When `AsRangeBoundaryInFlatTree()` converts a `TreeKind::DOM` point, the point
may be not in the flattened tree. E.g., the referring child node may be
replaced with a shadow tree without assigned to a `<slot>`. In this case, it
converts the point to the start or end of the container because `ShadowRoot` is
treated as positioned at index 0.5.

## nsINode API list

| `TreeKind` | `nsINode::GetParentNode<TreeKind>()` |
| ---------- | ------------------------------------ |
| `TreeKind::DOM` | `nsINode::GetParentNode()` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `nsINode::GetFlattenedTreeParentNodeForSelection()` |
| `TreeKind::Flat` | `nsINode::GetFlattenedTreeParentNode()` |

| `TreeKind` | `nsINode::GetChildAt<TreeKind>()` |
| ---------- | --------------------------------- |
| `TreeKind::DOM` | `nsINode::GetChildAt_Deprecated()` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `nsINode::GetChildAtInFlatTreeForSelection()` |
| `TreeKind::Flat` | `nsINode::GetChildAtInFlatTree()` |

| `TreeKind` | `nsINode::GetFirstChild<TreeKind>()` |
| ---------- | ------------------------------------ |
| `TreeKind::DOM` | `nsINode::GetFirstChild()` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `nsINode::GetFlattenedTreeFirstChildForSelection()` |
| `TreeKind::Flat` | `nsINode::GetFlattenedTreeFirstChild()` |

| `TreeKind` | `nsINode::GetLastChild<TreeKind>()` |
| ---------- | ----------------------------------- |
| `TreeKind::DOM` | `nsINode::GetLastChild()` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `nsINode::GetFlattenedTreeLastChildForSelection()` |
| `TreeKind::Flat` | `nsINode::GetFlattenedTreeLastChild()` |

| `TreeKind` | `nsINode::GetChildCount<TreeKind>()` |
| ---------- | ------------------------------------ |
| `TreeKind::DOM` | `nsINode::GetChildCount()` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `nsINode::GetFlatTreeForSelectionChildCount()` |
| `TreeKind::Flat` | `nsINode::GetFlatTreeChildCount()` |

| `TreeKind` | `nsINode::ComputeIndexOf<TreeKind>()` |
| ---------- | ------------------------------------- |
| `TreeKind::DOM` | `nsINode::ComputeIndexOf()` |
| `TreeKind::ShadowIncludingDOM` | N/A |
| `TreeKind::FlatForSelection` | `nsINode::ComputeFlatTreeForSelectionIndexOf()` |
| `TreeKind::Flat` | `nsINode::ComputeFlatTreeIndexOf()` |

| `TreeKind` | `nsINode::GetShadowRoot<TreeKind>()` |
| ---------- | ------------------------------------------ |
| `TreeKind::DOM` | N/A (The template API returns `nullptr`) |
| `TreeKind::ShadowIncludingDOM` | `nsINode::GetShadowRootForSelection()` |
| `TreeKind::FlatForSelection` | `nsINode::GetShadowRootForSelection()` |
| `TreeKind::Flat` | `nsINode::GetShadowRoot()` |

## nsIContent API list

| `TreeKind` | `nsIContent::GetAssignedSlot<TreeKind>()` |
| ---------- | ------------------------------------------ |
| `TreeKind::DOM` | N/A (The template API returns `nullptr`) |
| `TreeKind::ShadowIncludingDOM` | N/A (The template API returns `nullptr`) |
| `TreeKind::FlatForSelection` | `nsIContent::GetAssignedSlotForSelection()` |
| `TreeKind::Flat` | `nsIContent::GetAssignedSlot()` |
