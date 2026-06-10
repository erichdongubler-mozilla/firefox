import { render } from "@testing-library/react";
import { SectionContextMenu } from "content-src/components/DiscoveryStreamComponents/SectionContextMenu/SectionContextMenu";
import { WrapWithProvider } from "test/jest/test-utils";

describe("<SectionContextMenu>", () => {
  it("should render", () => {
    const { container } = render(
      <WrapWithProvider>
        <SectionContextMenu
          dispatch={jest.fn()}
          source=""
          index={0}
          sectionKey=""
          following={false}
          sectionPersonalization={null}
          sectionPosition={null}
        />
      </WrapWithProvider>
    );
    expect(
      container.querySelector(".section-context-menu")
    ).toBeInTheDocument();
  });
});
