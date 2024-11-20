const path = require("path");
const querystring = require("querystring");
const { Writable } = require('stream');


const getMimeType = (filePath) => {
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
  };
  return contentTypes[ext] || "application/octet-stream";
};

function findRoute(routes, req) {
  for (const route of routes) {
    if (route.method === req.method) {
      const routeParts = route.url.split("/");
      const urlParts = req.pathname.split("/");

      if (routeParts.length === urlParts.length) {
        const params = {};
        let match = true;

        for (let i = 0; i < routeParts.length; i++) {
          if (routeParts[i].startsWith(":")) {
            params[routeParts[i].slice(1)] = urlParts[i];
          } else if (routeParts[i] !== urlParts[i]) {
            match = false;
            break;
          }
        }

        if (match) {
          return { ...route, params };
        }
      }
    }
  }
  return null;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });

    writable.on('finish', () => {
      const body = Buffer.concat(chunks);
      try {
        const contentType = req.headers["content-type"];
        if (contentType === "application/json") {
          resolve(JSON.parse(body.toString()));
        } else if (contentType === "application/x-www-form-urlencoded") {
          resolve(querystring.parse(body.toString()));
        } else {
          resolve(body);
        }
      } catch (error) {
        reject(error);
      }
    });

    writable.on('error', reject);

    req.pipe(writable);
  });
}

function parseQueryString(req) {
  const parsedUrl = url.parse(req.url, true);
  return parsedUrl.query;
}

module.exports = { getMimeType, findRoute, parseBody, parseQueryString };
