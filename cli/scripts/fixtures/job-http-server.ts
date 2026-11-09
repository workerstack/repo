import http from "node:http";

/**
 * A 127.0.0.1 server for the job fetch tests, run in its own process because `runFetch` blocks its caller.
 * Prints its port on the first line. `/page` is a small html page, `/empty` an empty body, `/big` more text than the
 * stash cap, `/hang` never answers.
 */
const page = `<html><head><title>  Demo   page </title><style>p{color:red}</style></head><body>
<script>var x = 1;</script><p>First &amp; second.&nbsp;Third &lt;ok&gt;. Fourth sentence.</p></body></html>`;
const BIG = 3 * 1024 * 1024;

const server = http.createServer((req, res) => {
  if (req.url === "/hang") return;
  if (req.url === "/empty") return void res.end("");
  if (req.url === "/big") return void res.end("word. ".repeat(BIG / 6));
  res.end(page);
});
server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  console.log(typeof addr === "object" && addr ? addr.port : 0);
});
