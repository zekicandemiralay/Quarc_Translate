// One error type for everything the API refuses to do, so every failure leaves
// the server as { error, code, ...details } and the app can react to `code`
// (e.g. show "preparing the model…" instead of a generic failure).

class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (code, message, details) => new ApiError(400, code, message, details);

function errorBody(err) {
  return { error: err.message, code: err.code, ...err.details };
}

module.exports = { ApiError, badRequest, errorBody };
