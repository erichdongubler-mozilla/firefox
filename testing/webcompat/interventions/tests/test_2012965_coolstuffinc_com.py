import pytest

URL = "https://www.coolstuffinc.com/main_search.php?pa=searchOnName&page=1&resultsPerPage=25&q=test"
SELECT_CSS = "#mainContent select.searchMenu[name=sb]"


async def is_fastclick_active(client):
    async with client.ensure_fastclick_activates():
        # the search results don't always load properly, so try a few times.
        for _ in range(10):
            await client.navigate(URL)
            if client.find_css(SELECT_CSS):
                break
        return client.test_for_fastclick(
            client.await_css(SELECT_CSS, is_displayed=True)
        )


@pytest.mark.only_platforms("android")
@pytest.mark.asyncio
@pytest.mark.with_interventions
async def test_enabled(client):
    assert not await is_fastclick_active(client)


@pytest.mark.only_platforms("android")
@pytest.mark.asyncio
@pytest.mark.without_interventions
async def test_disabled(client):
    assert await is_fastclick_active(client)
