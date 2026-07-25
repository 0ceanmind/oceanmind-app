// Bootstrap: verify Node version (node:sqlite needs >= 22.13), then start the app.
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(
    `\nOceanMind requires Node.js 22.13 or newer (you are running ${process.versions.node}).\n` +
      'It uses the built-in node:sqlite module, so no native packages are needed.\n' +
      'Please upgrade Node from https://nodejs.org and run again.\n'
  );
  process.exit(1);
}

const { startServer } = await import('./app.js');
startServer();
