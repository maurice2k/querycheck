# Changelog

## [2.0.0] - 2026-10-30

QueryCheck now compiles queries into closures, no longer relies on JavaScript's comparison operators across types, and follows the [PHP version](https://github.com/maurice2k/querycheck-php) 2.0.0: the same operators, the same comparison rules and the same syntax errors.

Queries that compare values of the same type (numbers with numbers, strings with strings, as in `{age: {$gte: 18}}` on `30`) give the same results as in 1.x. The changed results are mostly edge cases where values of different types were compared and JavaScript's type coercion decided the outcome: `null >= 0`, `[20] >= 18` and `true > 0` were all true in 1.x and no longer are. A few changes go beyond that:

* missing fields throw `UnknownVariableException` by default,
* `NaN` now equals `NaN`, as in MongoDB,
* `$ne` and `$in` look at the elements of array fields,
* only own properties of the document are resolved,
* some broken queries are now a `SyntaxError` instead of silently matching or not matching,
* `setUndefinedEqualsNull()` was removed.

Because results can change, this is a major release. See [Upgrading from 1.x](#upgrading-from-1x) for what to check.

### Security

* **`$gt`, `$gte`, `$lt`, `$lte` no longer use JavaScript's `>` and `<` across types.** In 1.x, `{age: {$gte: 0}}` matched `null`, `false`, `[]` and `[5]`, `{age: {$gte: 18}}` matched `[20]` and `["20"]`, and `{failedAttempts: {$lt: 5}}` matched `null`, `false` and `[]`. Values of different types no longer match (see [Comparison Rules](README.md#comparison-rules)).
* **Inherited properties are no longer resolved.** In 1.x, `{constructor: {$ne: null}}` or `{"toString": {$ne: null}}` matched every document, and `__proto__` resolved to `Object.prototype`. Only own properties are resolved now, and `length` of an array is no longer a field.
* **`$ne` is the negation of `$eq` on array fields, and `$in` matches array elements.** In 1.x, `{role: {$ne: "banned"}}` matched `["banned", "admin"]`, and `{role: {$in: ["admin"]}}` did not match `["admin"]`. Allow lists and deny lists on the same field now agree.
* **Strict mode no longer mixes strings and numbers in `$in` and array elements.** In 1.x, strict `{id: {$in: [1]}}` matched `"1"`.
* **`$regex` only matches strings** (and numbers as text without strict mode). In 1.x, the value was converted to a string first, so `{v: {$regex: "null"}}` matched `null`, `{v: {$regex: "undefined"}}` matched a missing field and `{v: {$regex: "object"}}` matched every object.
* **A lone `$options` is a `SyntaxError`.** In 1.x, `{v: {$options: "i"}}` matched every document.
* **Unknown operators are a `SyntaxError`.** In 1.x, `{age: {$gtt: 18}}` was compared as the literal object `{$gtt: 18}`, and `{age: {$gt: 18, $foo: 1}}` threw a plain `Error` only when reached.
* **`Date`s are compared by time.** In 1.x, any two `Date`s were equal (they have no own keys).

### Changed

* **Comparison rules** for `$gt`, `$gte`, `$lt`, `$lte`:
  * numbers vs numbers numerically, strings vs strings by code point (`"10" < "9"`, characters above U+FFFF sort after U+E000–U+FFFF as in UTF-8), booleans vs booleans (`false < true`), `null` vs `null` as equal, `Date` vs `Date` by time;
  * without strict mode, a number vs a numeric string still compares numerically (`137 > "136"`);
  * anything else does not match (in strict mode it throws, except for `null`);
  * an array field never matches them (MongoDB compares each element).
* **Numbers and BigInts are one type**, compared exactly: `{v: 12}` matches `12n`, `9007199254740993n` does not equal `9007199254740992`.
* **`NaN` equals `NaN`** for `$eq`, `$ne`, `$in`, `$gte` and `$lte`, and is never greater or less than a number, as in MongoDB.
* **`{v: null}` matches `[null]`**, so `$eq` and `$ne` stay each other's negation on arrays.
* **Missing fields** throw `UnknownVariableException` by default; `setThrowOnUnknownVariable(false)` makes them compare as `null`. A field with the value `undefined` counts as missing. 1.x evaluated them as `undefined`, which did not equal `null`.
* **`$or` short-circuits**: it stops at the first matching branch, like `$and`. Later branches are not evaluated, cannot throw, and the operand evaluator is not called for them.
* **Syntax errors are reported for the whole query** on the first `test()`, also in branches that would not be evaluated for that document, and start with their location (`$or[1].age.$not.foo: Unsupported query operator: foo`).
* **More mistakes are a `SyntaxError`** instead of silently changing the result (see [Compiled Queries](README.md#compiled-queries)): an unknown operator, an object that mixes fields and operators, `$in` with an operand that is not an array, `$not` with a value instead of an operator expression, empty `$and`/`$or`, `$gt`/`$gte`/`$lt`/`$lte` against an array or object literal, a lone `$options`, a query that is not an object, and paths with an empty segment (`a..b`, `.`).
* **`$regex`**: the pattern must be a string and `$options` may only contain `i`, `m`, `s`, `x` and `u` (1.x passed any JavaScript flags, including `g` and `y`). `x` is emulated. Invalid patterns are a `SyntaxError` on the first `test()`; in strict mode a non-string value other than `null` throws `StrictTypeError`.
* **Strict mode** now means: two non-null values of different types are an error (numbers and BigInts are one type), `null` never is.
  * `$ne` throws exactly when `$eq` would (1.x returned `true` for `{v: {$ne: 137}}` on `"137"`).
  * `$gt`, `$gte`, `$lt`, `$lte` with `null` against another type do not match and do not throw (1.x threw for a `null` operand).
  * `$gt`, `$gte`, `$lt`, `$lte` throw for arrays and objects.
* **Errors** are QueryCheck error classes. They extend the built-in errors 1.x threw (`SyntaxError`, `TypeError`), so existing `instanceof` checks keep working, except for unknown operators, which threw a plain `Error` in 1.x.
* **The negated expression of `$not`** gets an empty object as data instead of `undefined` (relevant for operand evaluators).
* **Node.js 20 or newer** is required.

### Removed

* **`setUndefinedEqualsNull()`.** Use `setThrowOnUnknownVariable(false)`: a missing field compares as `null` instead of throwing.

### Added

* [`$expr`](https://www.mongodb.com/docs/manual/reference/operator/query/expr/) with the aggregation operators `$add`, `$subtract`, `$multiply`, `$divide`, `$mod`, `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$not`, `$in`, `$cond`, `$size`, `$toLower`, `$toUpper`, `$concat`, `$substr`, `$substrBytes`, `$strLenBytes`, `$strLenCP`, `$trim`, `$ltrim`, `$rtrim` and [`$literal`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/literal/).
* `setThrowOnUnknownVariable(bool)`: missing fields throw `UnknownVariableException` by default; pass `false` to compare them as `null` instead.
* Compiled queries: the query is compiled into closures on the first `test()` and reused for every later call. Setters discard the compiled query.
* `validate()`: compiles the query now and throws `SyntaxError` for an invalid query, so broken rules can be found where they are loaded instead of with the first document.
* Error classes, all exported from the package and `instanceof QueryCheck.QueryCheckError`: `QuerySyntaxError` (also `SyntaxError`), `StrictTypeError`, `RegexError` (a `$regex` that fails while matching) and `UnknownVariableException`. Syntax errors with a location have the original error as `cause`.
* BigInt and `Date` support in comparisons.
* TypeScript declarations (`index.d.ts`).
* README sections: Comparison Rules, Strict Mode, Missing Fields, Differences from MongoDB, Differences from the PHP Version, Regular Expressions.
* Docker test setup for Node.js 20, 22 and 24 (`make test`), a type check (`make types`) and a benchmark (`make bench`).

### Performance

Measured on Node.js 24, against 1.1.2 (numbers vary a little between runs):

| Query | First `test()` incl. build | Each later `test()` |
|---|---|---|
| 1 condition | 1.4× faster | 9.8× faster |
| Medium (4 fields, `$in`, `$or`) | 1.5× faster | 6.6× faster |
| Strings + `$regex` | 1.5× faster | 5.1× faster |
| 50 conditions | 1.7× faster | 5.2× faster |

Create one `QueryCheck` per query and reuse it.

### Tests

* 3,733 tests (up from 238), run on Node.js 20, 22 and 24, including the ported PHP test suite, a cross-check of the specialized closures against the generic implementations, and checks of every README example.

### Upgrading from 1.x

Replace `setUndefinedEqualsNull(true)` with `setThrowOnUnknownVariable(false)`. If you relied on missing fields not throwing, call `setThrowOnUnknownVariable(false)`; note that a missing field then equals `null`.

Check queries that rely on any of these:

* **Mixed types in `$gt`, `$gte`, `$lt`, `$lte`.** `null`, booleans, arrays and non-numeric strings no longer pass a numeric bound. Convert values to numbers before calling `test()` if needed.
* **`$ne` and `$in` on array fields** now look at the elements.
* **Inherited properties and `length`.** `{"items.length": {$gt: 0}}` no longer works; use `{$expr: {$gt: [{$size: "$items"}, 0]}}`.
* **`$or` with later branches that throw** (for example a missing field) now returns `true` if an earlier branch matched.
* **`NaN`** now equals `NaN`.
* **Strict mode:** `$ne` now throws for a string vs a number; `null` no longer throws in ordering.
* **Syntax errors** in unreached branches are now reported, and more mistakes are syntax errors. Call `validate()` where rules are loaded to find them early.
* **`$regex`** on non-strings: `null`, booleans, arrays and objects no longer match; only `i`, `m`, `s`, `x` and `u` are allowed as options.

## [1.1.2] and earlier

See the git history.
