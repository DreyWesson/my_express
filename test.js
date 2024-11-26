const { MyExpress } = require("./src/index.js");

const myExpress = new MyExpress();
const PORT = 4241;

// Global middleware
myExpress.use((req, res, next) => {
  if (!req.pathname.startsWith("/public")) {
    console.log("Middleware 1: Request received at", new Date());
  }
  next();
});

myExpress.use((req, res, next) => {
  console.log("Middleware 2: Setting customProperty");
  req.customProperty = "Hello from middleware";
  next();
});

// Path-specific middleware
myExpress.use("/api", (req, res, next) => {
  console.log("API Middleware: Accessed API route");
  next();
});

// Define routes before static middleware
myExpress.get("/", (req, res) => {
  console.log("Root route handler executed");
  console.log("Custom property from middleware:", req.customProperty);
  res.status(200).sendFile("./public/index.html");
});

myExpress.get("/api/data", (req, res) => {
  console.log("API data route handler executed");
  res.json({ message: "This is API data" });
});

myExpress.post("/", (req, res) => {
  console.log("POST root route handler executed");
  res.json(req.body);
});

myExpress.get("/api", (req, res) => {
  console.log("API route handler executed");
  res.status(200).json({ data: "API Middleware test" });
});

myExpress.post("/api/test-json", (req, res) => {
  // If the jsonParser works correctly, the body will be parsed and available in `req.body`.
  if (req.body) {
    res.status(200).json({ message: "JSON parsed successfully!", data: req.body });
  } else {
    res.status(400).json({ error: "Failed to parse JSON." });
  }
});

// New routes to showcase `setupRequest` functionality
myExpress.get("/query", (req, res) => {
  console.log("Query string route handler executed");
  res.json({ query: req.query });
});

myExpress.get("/pathname", (req, res) => {
  console.log("Pathname route handler executed");
  res.json({ pathname: req.pathname });
});


// Static file middleware after route definitions
myExpress.static("/", "public");
myExpress.static("/assets", "assets");

// Catch-all middleware for unhandled requests
myExpress.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode === 404) {
      console.log("Catch-all middleware: Unhandled request", req.method, req.url);
    }
  });
  next();
});

// Error handling middleware
myExpress.use((err, req, res, next) => {
  console.error("Error Middleware:", err);
  res.status(500).send("Something went wrong!");
});

// Catch-all route for unmatched routes
myExpress.get("*", (req, res) => {
  console.log("Catch-all route handler: Unhandled request", req.method, req.pathname);
  res.status(404).send("Not Found");
});

myExpress.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});