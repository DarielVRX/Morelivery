export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next({ statusCode: 400, message: result.error.issues.map((issue) => issue.message).join(', ') });
    }
    req.validatedBody = result.data;
    return next();
  };
}
