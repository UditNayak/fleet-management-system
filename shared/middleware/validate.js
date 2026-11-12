const AppError = require('../errors/AppError');

const PARTS = ['params', 'query', 'body'];

/**
 * Validates request parts with Joi schemas and replaces them with the cleaned values
 * (trimmed strings, converted numbers, defaults applied).
 *   validate({ params: idSchema, body: updateSchema })
 */
function validate(schemas) {
  return (req, _res, next) => {
    const details = [];
    const cleaned = {};

    for (const part of PARTS) {
      if (!schemas[part]) continue;
      const { value, error } = schemas[part].validate(req[part] ?? {}, { abortEarly: false });
      if (error) {
        details.push(
          ...error.details.map((d) => ({
            location: part,
            field: d.path.join('.'),
            message: d.message.replace(/"/g, ''),
          })),
        );
      } else {
        cleaned[part] = value;
      }
    }

    if (details.length) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
    }

    if (cleaned.body) req.body = cleaned.body;
    if (cleaned.params) req.params = cleaned.params;
    // Express 5 makes req.query a read-only getter, so redefine it with the cleaned value
    if (cleaned.query) {
      Object.defineProperty(req, 'query', {
        value: cleaned.query,
        writable: true,
        enumerable: true,
      });
    }
    return next();
  };
}

module.exports = validate;
