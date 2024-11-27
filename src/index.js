const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const {
  getMimeType,
  findRoute,
  jsonParser,
  urlencodedParser,
} = require("./utils");

class MyExpress {
  #server = null;
  #routes = [];
  #middleware = [];
  #errorMiddleware = [];
  #staticDir = null;

  constructor() {
    this.#server = http.createServer(this.#handleRequest.bind(this));
    this.#server.on("error", this.#handleServerError);
  }

  static(urlPath, dirPath, options = {}) {
    this.#staticDir = dirPath; // Store for SPA fallback
    const serveStatic = this.#createStaticMiddleware(urlPath, dirPath, options);
    this.use("/", serveStatic);
  }

  get = (url, ...cb) => this.route("GET", url, ...cb);
  post = (url, ...cb) => this.route("POST", url, ...cb);
  put = (url, ...cb) => this.route("PUT", url, ...cb);
  patch = (url, ...cb) => this.route("PATCH", url, ...cb);
  delete = (url, ...cb) => this.route("DELETE", url, ...cb);
  head = (url, ...cb) => this.route("HEAD", url, ...cb);
  options = (url, ...cb) => this.route("OPTIONS", url, ...cb);
  trace = (url, ...cb) => this.route("TRACE", url, ...cb);
  connect = (url, ...cb) => this.route("CONNECT", url, ...cb);
  all = (url, ...cb) => {
    const methods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
      "TRACE",
      "CONNECT",
    ];
    methods.forEach((method) => this.route(method, url, ...cb));
  };

  use(path, middleware) {
    if (typeof path === "function") {
      middleware = path;
      path = "/";
    }
    this.#addMiddleware(path, middleware);
  }

  route = (method, url, ...handlers) => {
    this.#routes.push({ method, url, handlers: handlers.flat() });
  };

  listen = (port, host, callback) => {
    if (typeof host === "function") {
      callback = host;
      host = undefined;
    }

    host = host || "0.0.0.0";

    port = Number(port);

    if (isNaN(port) || port <= 0 || port > 65535) {
      throw new Error("Invalid port number");
    }

    this.#server.listen(port, host, () => {
      if (typeof callback === "function") {
        callback();
      }
    });

    return this;
  };

  // Private methods
  #handleServerError = (error) => {
    console.error("Server error:", error);
  };

  #addMiddleware = (path, middleware) => {
    if (middleware.length === 4) {
      this.#errorMiddleware.push({ path, middleware });
    } else {
      this.#middleware.push({ path, middleware });
    }
  };

  #handleRequest = async (req, res) => {
    this.#setupRequest(req);
    this.#setupResponse(res);

    await this.#executeMiddleware(req, res);
  };

  #setupRequest = (req) => {
    const protocol = req.connection.encrypted ? "https" : "http";
    const host = req.headers.host || "localhost";

    const parsedUrl = new URL(req.url, `${protocol}://${host}`);

    req.pathname = parsedUrl.pathname;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());
    req.searchParams = parsedUrl.searchParams;
  };

  #setupResponse = (res) => {
    res.status = (code) => this.#setStatus(res, code);
    res.sendFile = (filepath, options = {}) =>
      this.#sendFile(res, filepath, options);
    res.send = (data) => this.#sendResponse(res, data);
    res.json = (data) => this.#jsonResponse(res, data);
    res.set = (header, value) => {
      res.setHeader(header, value);
    };
  };

  #createStaticMiddleware = (urlPath, dirPath, options) => {
    return async (req, res, next) => {
      try {
        const filePath = this.#resolveStaticFilePath(req, dirPath);
        await this.#serveStaticFile(res, filePath, options);
      } catch (error) {
        if (error.code === "ENOENT") return next();
        console.error("Static middleware error:", error);
        this.#sendErrorResponse(res, 500);
      }
    };
  };

  #resolveStaticFilePath = (req, dirPath) => {
    return req.url === "/" || req.url === ""
      ? path.join(process.cwd(), dirPath, "index.html")
      : path.join(process.cwd(), dirPath, req.url);
  };

  #serveStaticFile = async (res, filePath, options) => {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) this.#sendFile(res, filePath, options);
    else throw new Error("Not a file");
  };

  #executeMiddleware = async (req, res) => {
    let middlewareIndex = 0;

    const next = async (error) => {
      if (res.writableEnded) return;

      if (error) return this.#executeErrorMiddleware(error, req, res, next);

      if (middlewareIndex < this.#middleware.length) {
        const { path, middleware } = this.#middleware[middlewareIndex++];
        await this.#handleMiddleware(req, res, next, path, middleware);
      } else {
        await this.#processRequest(req, res);
      }
    };
    await next();
  };

  #handleMiddleware = async (req, res, next, path, middleware) => {
    if (req.pathname.startsWith(path)) {
      try {
        await new Promise((resolve) => {
          middleware(req, res, (err) => {
            if (err) next(err);
            else resolve();
          });
        });
        await next();
      } catch (error) {
        next(error);
      }
    } else {
      await next();
    }
  };

  #executeErrorMiddleware = async (err, req, res, next) => {
    for (const { path, middleware } of this.#errorMiddleware) {
      if (req.url.startsWith(path)) {
        try {
          await middleware(err, req, res, next);
          if (res.writableEnded) return;
        } catch (newErr) {
          err = newErr;
        }
      }
    }
    if (!res.writableEnded) this.#sendErrorResponse(res, 500);
  };

  #processRequest = async (req, res) => {
    const routeMatch = findRoute(this.#routes, req);

    if (!routeMatch) {
      await this.#handleUnmatchedRoute(req, res);
      return;
    }

    req.params = { ...routeMatch.params };

    await this.#handleMatchedRoute(routeMatch, req, res);
  };

  #handleUnmatchedRoute = async (req, res) => {
    if (this.#staticDir) {
      const fallbackPath = path.join(
        process.cwd(),
        this.#staticDir,
        "index.html"
      );
      try {
        await this.#serveStaticFile(res, fallbackPath, {});
      } catch {
        this.#sendNotFoundResponse(res);
      }
    } else {
      this.#sendNotFoundResponse(res);
    }
  };

  #handleMatchedRoute = async (routeMatch, req, res) => {
    try {
      await this.#executeRouteHandlers(routeMatch, req, res);
    } catch (error) {
      await this.#executeErrorMiddleware(error, req, res, () => {});
    }
  };

  #executeRouteHandlers = async (route, req, res) => {
    let handlerIndex = 0;
    const next = async (error) => {
      if (error) return this.#executeErrorMiddleware(error, req, res, () => {});

      const handler = route.handlers[handlerIndex++];
      if (handler) await handler(req, res, next);
    };
    await next();
  };

  #setStatus = (res, code) => {
    res.statusCode = code;
    return res;
  };

  #sendFile = async (res, filePath, options = {}) => {
    const mimeType = options.mimeType || getMimeType(filePath); // Use custom MIME type if provided
    res.setHeader("Content-Type", mimeType);

    if (options.maxAge) {
      res.setHeader("Cache-Control", `public, max-age=${options.maxAge}`);
    }

    try {
      const fileHandle = await fs.open(filePath, "r");
      fileHandle.createReadStream().pipe(res);
    } catch (error) {
      console.error("Error serving file:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  };

  #sendResponse = (res, data) => {
    if (typeof data === "object") return this.#jsonResponse(res, data);

    res.setHeader("Content-Type", "text/plain");
    res.end(data);
  };

  #jsonResponse = (res, data) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };

  #sendErrorResponse = (res, code) => {
    res.writeHead(code, { "Content-Type": "text/plain" });
    res.end(http.STATUS_CODES[code]);
  };

  #sendNotFoundResponse = (res) => {
    this.#sendErrorResponse(res, 404);
  };
}

module.exports = { MyExpress, jsonParser, urlencodedParser };
