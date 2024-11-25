const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const url = require("url");
const { getMimeType, findRoute, parseBody } = require("./utils");

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

  listen = (port, cb) => {
    this.#server.listen(port, "localhost", cb);
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

    if (["POST", "PUT", "PATCH"].includes(req.method)) {
      req.body = await parseBody(req); // Use parseBody for parsing request body
    }

    await this.#executeMiddleware(req, res);
  };

  #setupRequest = (req) => {
    const { pathname, query } = url.parse(req.url, true);
    req.pathname = pathname;
    req.query = query;
  };

  #setupResponse = (res) => {
    res.status = (code) => this.#setStatus(res, code);
    res.sendFile = (filepath) => this.#sendFile(res, filepath);
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
        this.#handleMiddleware(req, res, next, path, middleware);
      } else {
        await this.#processRequest(req, res); // Move to route handling
      }
    };
    await next();
  };

  #handleMiddleware = async (req, res, next, path, middleware) => {
    if (req.pathname.startsWith(path)) {
      try {
        await middleware(req, res, next);
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
    const route = findRoute(this.#routes, req);

    if (!route) {
      await this.#handleUnmatchedRoute(req, res);
      return;
    }
    await this.#handleMatchedRoute(route, req, res);
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

  #handleMatchedRoute = async (route, req, res) => {
    try {
      await this.#executeRouteHandlers(route, req, res);
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

  #sendFile = async (res, filePath, options) => {
    const mimeType = getMimeType(filePath);
    res.setHeader("Content-Type", mimeType);
    if (options.maxAge)
      res.setHeader("Cache-Control", `public, max-age=${options.maxAge}`);

    const fileHandle = await fs.open(filePath, "r");
    fileHandle.createReadStream().pipe(res);
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

module.exports = { MyExpress };
