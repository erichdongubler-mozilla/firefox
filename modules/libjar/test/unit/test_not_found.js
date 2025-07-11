// Should report file not found on non-existent files

const { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
);
const path = "data/test_bug333423.zip";

function run_test() {
  var spec = "jar:" + Services.io.newFileURI(do_get_file(path)).spec + "!/";
  var channel = NetUtil.newChannel({
    uri: spec + "file_that_isnt_in.archive",
    loadUsingSystemPrincipal: true,
  });
  try {
    channel.open();
    do_throw("Failed to report that file doesn't exist");
  } catch (e) {
    Assert.equal(e.name, "NS_ERROR_FILE_NOT_FOUND");
  }
}
