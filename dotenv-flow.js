process.env.NODE_ENV = "production";
if (!process.env.NODE_ENV)
  throw new Error("Must define the right NODE_ENV to use the right .env.file");
require("dotenv-flow").config({
  silent: true, // Hides "already defined process.env" annoying ass errors
});
