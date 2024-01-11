// We have to set the url here to ensure we get the same escaping as in the harness
// and also to handle the case where the test changes the fragment
window.__wptrunner_url = `%(url)s`; // TODO: is there something better to do here? NOTE: This has changed since initial authoring, see if this isn't sufficient now.
window.__wptrunner_testdriver_callback = arguments[arguments.length - 1];
window.__wptrunner_process_next_event();
