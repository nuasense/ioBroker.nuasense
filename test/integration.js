const path = require("path");
const { tests } = require("@iobroker/testing");

// Starts a js-controller with the adapter installed and checks that the
// adapter starts and stops cleanly. With an empty configuration the adapter
// logs that nothing is configured and stays idle, which is the expected state.
tests.integration(path.join(__dirname, ".."));
