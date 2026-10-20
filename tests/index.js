// Lets `node --test tests/` work on Node 21 and newer, where the test runner no longer expands a
// directory argument. Older versions expand the directory themselves and find the test files directly.
if (Number(process.versions.node.split('.')[0]) >= 21) {
  import('./engine.test.mjs');
}
