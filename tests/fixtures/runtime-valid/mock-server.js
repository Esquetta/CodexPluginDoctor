process.stdin.resume();

const timer = setInterval(() => {
  process.stdout.write("");
}, 50);

function shutdown() {
  clearInterval(timer);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

