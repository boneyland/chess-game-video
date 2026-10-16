// Load the page's plain-script units (IIFEs that assign window.*) into Node for tests.
const path = require('path');
globalThis.window = globalThis;
const APP = path.join(__dirname, '..', 'app');
function loadUnit(rel) { require(path.join(APP, rel)); }
const fixture = (name) => require(path.join(__dirname, 'fixtures', name));
module.exports = { loadUnit, fixture };
