const fs = require("fs");
const path = require("path");
const traverse = require("traverse");
const get = require("lodash.get");

/**
 * Return an Array of every possible non-cyclic path in the object as a dot separated string sorted
 * by length.
 *
 * Example:
 * getSortedObjectPaths({ process: { env: { NODE_ENV: "development" } } });
 * // => [ "process.env.NODE_ENV", "process.env" "process" ]
 *
 * @param  {Object}  obj  A plain JavaScript Object
 * @return {Array}  Sorted list of non-cyclic paths into obj
 */
export const getSortedObjectPaths = (obj) => {
  if (!obj) { return []; }

  return traverse(obj)
    .paths()
    .filter((arr) => arr.length)
    .map((arr) => arr.join("."))
    .sort((elem) => elem.length);
};

/**
 *  `babel-plugin-transfor-define` take options of two types: static config and a path to a file that
 *  can define config in any way a user sees fit. getReplacements takes the options and will either
 *  return the static config or get the dynamic config from disk
 * @param  {Object|String}  configOptions  configuration to parse
 * @return {Object}  replacement object
 */
const getReplacements = (configOptions) => {
  if (typeof configOptions === "object") { return configOptions; }

  try {
    const fullPath = path.join(process.cwd(), configOptions);
    fs.accessSync(fullPath, fs.F_OK);
    return require(fullPath);
  } catch (err) {
    console.error(`The nodePath: ${configOptions} is not valid.`); // eslint-disable-line
    throw new Error(err);
  }
};

/**
 * Replace a node with a given value. If the replacement results in a BinaryExpression, it will be
 * evaluated. For example, if the result of the replacement is `var x = "production" === "production"`
 * The evaluation will make a second replacement resulting in `var x = true`
 * @param  {function}   replaceFn    The function used to replace the node
 * @param  {babelNode}  nodePath     The node to evaluate
 * @param  {*}          replacement  The value the node will be replaced with
 * @return {undefined}
 */
const replaceAndEvaluateNode = (replaceFn, nodePath, replacement) => {
  nodePath.replaceWith(replaceFn(replacement));

  if (nodePath.parentPath.isBinaryExpression()) {
    const result = nodePath.parentPath.evaluate();

    if (result.confident) {
      nodePath.parentPath.replaceWith(replaceFn(result.value));
    }
  }
};

/**
 * Get the first value in the `obj` that causes the comparator to return true
 * @param  {Object}     obj         The object to search for replacements
 * @param  {function}   comparator  The function used to evaluate whether a node matches a value in `obj`
 * @param  {babelNode}  nodePath    The node to evaluate
 * @return {*}  The first matching value to replace OR null
 */
const getFirstReplacementValueForNode = (obj, comparator, nodePath) => {
  const replacementKey = getSortedObjectPaths(obj)
    .filter((value) => comparator(nodePath, value))
    .shift();
  return get(obj, replacementKey) || null;
};

/**
 * Run the transformation over a node
 * @param  {Object}     replacements The object to search for replacements
 * @param  {babelNode}  nodePath     The node to evaluate
 * @param  {function}   replaceFn    The function used to replace the node
 * @param  {function}   comparator   The function used to evaluate whether a node matches a value in `replacements`
 * @return {undefined}
 */
const processNode = (replacements, nodePath, replaceFn, comparator) => { // eslint-disable-line
  const replacement = getFirstReplacementValueForNode(replacements, comparator, nodePath);
  if (replacement) {
    replaceAndEvaluateNode(replaceFn, nodePath, replacement);
  }
};

const memberExpressionComparator = (nodePath, value) => nodePath.matchesPattern(value);
const identifierComparator = (nodePath, value) => nodePath.node.name === value;
const unaryExpressionComparator = (nodePath, value) => nodePath.node.argument.name === value;

export default function ({ types: t }) {
  return {
    visitor: {

      // process.env.NODE_ENV;
      MemberExpression(nodePath, state) {
        processNode(getReplacements(state.opts), nodePath, t.valueToNode, memberExpressionComparator);
      },

      // const x = { version: VERSION };
      Identifier(nodePath, state) {
        processNode(getReplacements(state.opts), nodePath, t.valueToNode, identifierComparator);
      },

      // typeof window
      UnaryExpression(nodePath, state) {
        if (nodePath.node.operator !== "typeof") { return; }

        const replacements = getReplacements(state.opts);
        const keys = Object.keys(replacements);
        const typeofValues = {};

        keys.forEach((key) => {
          if (key.substring(0, 7) === "typeof ") {
            typeofValues[key.substring(7)] = replacements[key];
          }
        });

        processNode(typeofValues, nodePath, t.valueToNode, unaryExpressionComparator);
      }

    }
  };
}
