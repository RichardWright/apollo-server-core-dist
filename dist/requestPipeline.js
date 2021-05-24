"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processGraphQLRequest = exports.APQ_CACHE_PREFIX = exports.InvalidGraphQLRequestError = void 0;

// perf hook - RW
const performanceTest = require("perf_hooks").performance;
const PerformanceObserver = require("perf_hooks").PerformanceObserver;
const diagnostics_channel = require('diagnostics_channel');
const channel = diagnostics_channel.channel('apollo-server-core');

const blocked = ['resolveFieldValueOrError', 'completeValueCatchingError'];

function filterRender(item) {
    if (item.name && item.duration) {
        if (blocked.find[item.name]) {
            if (item.duration < 0.001) {
                return false;
            }
            return true;
        }
        return true;
    }
    return false;
}

const obs = new PerformanceObserver((items) => {
    items.getEntries().forEach((item) => {
        if (filterRender(item)) {
            //console.log('@@@ - ' + item.name, + ' ' + item.duration);
            //console.log(JSON.stringify(item));
            const parts = item.name.split('-');
            //const fullName = item.name;

            const functionName = parts[0];
            //const fileName = parts[1]
            const operationName = parts[1];
            channel.publish({
                name: item.name,
                functionName: functionName,
                operationName: operationName,
                duration: item.duration
            });
        }
    })
})

obs.observe({ entryTypes: ['measure'] })


const computeQueryHashMark = "computeQueryHash";
const parseMark = "parse";
const responseForOperationMark = "responseForOperation";
const enablePluginsMark = "enablePluginsForSchemaResolvers";

const test8 = "invokeHookAsyncwillSendResponse";
//const test9 = "formatResponse";

const graphql_1 = require("graphql");
const graphql_extensions_1 = require("graphql-extensions");
const schemaInstrumentation_1 = require("./utils/schemaInstrumentation");
const apollo_server_errors_1 = require("apollo-server-errors");
const apollo_server_types_1 = require("apollo-server-types");
Object.defineProperty(exports, "InvalidGraphQLRequestError", { enumerable: true, get: function () { return apollo_server_types_1.InvalidGraphQLRequestError; } });
const dispatcher_1 = require("./utils/dispatcher");
const apollo_server_caching_1 = require("apollo-server-caching");
const createSHA_1 = __importDefault(require("./utils/createSHA"));
const runHttpQuery_1 = require("./runHttpQuery");
exports.APQ_CACHE_PREFIX = 'apq:';
function computeQueryHash(query) {
    return createSHA_1.default('sha256')
        .update(query)
        .digest('hex');
}
const symbolExtensionDeprecationDone = Symbol("apolloServerExtensionDeprecationDone");
function processGraphQLRequest(config, requestContext) {
    return __awaiter(this, void 0, void 0, function* () {
        const logger = requestContext.logger || console;
        const metrics = requestContext.metrics =
            requestContext.metrics || Object.create(null);
        const extensionStack = initializeExtensionStack();
        requestContext.context._extensionStack = extensionStack;
        const dispatcher = initializeRequestListenerDispatcher();
        yield initializeDataSources();
        const request = requestContext.request;
        let { query, extensions } = request;
        let queryHash;
        let persistedQueryCache;
        metrics.persistedQueryHit = false;
        metrics.persistedQueryRegister = false;
        if (extensions && extensions.persistedQuery) {
            if (!config.persistedQueries || !config.persistedQueries.cache) {
                return yield emitErrorAndThrow(new apollo_server_errors_1.PersistedQueryNotSupportedError());
            }
            else if (extensions.persistedQuery.version !== 1) {
                return yield emitErrorAndThrow(new apollo_server_types_1.InvalidGraphQLRequestError('Unsupported persisted query version'));
            }
            persistedQueryCache = config.persistedQueries.cache;
            if (!(persistedQueryCache instanceof apollo_server_caching_1.PrefixingKeyValueCache)) {
                persistedQueryCache = new apollo_server_caching_1.PrefixingKeyValueCache(persistedQueryCache, exports.APQ_CACHE_PREFIX);
            }
            queryHash = extensions.persistedQuery.sha256Hash;
            if (query === undefined) {
                query = yield persistedQueryCache.get(queryHash);
                if (query) {
                    metrics.persistedQueryHit = true;
                }
                else {
                    return yield emitErrorAndThrow(new apollo_server_errors_1.PersistedQueryNotFoundError());
                }
            }
            else {
                const computedQueryHash = computeQueryHash(query);
                if (queryHash !== computedQueryHash) {
                    return yield emitErrorAndThrow(new apollo_server_types_1.InvalidGraphQLRequestError('provided sha does not match query'));
                }
                metrics.persistedQueryRegister = true;
            }
        }
        else if (query) {
            console.log('request - query exists, measure');
            performanceTest.mark(computeQueryHashMark);
            queryHash = computeQueryHash(query);
            performanceTest.measure("computeQueryHash", computeQueryHashMark);
        }
        else {
            return yield emitErrorAndThrow(new apollo_server_types_1.InvalidGraphQLRequestError('Must provide query string.'));
        }
        requestContext.queryHash = queryHash;
        requestContext.source = query;
        yield dispatcher.invokeHookAsync('didResolveSource', requestContext);
        const requestDidEnd = extensionStack.requestDidStart({
            request: request.http,
            queryString: request.query,
            operationName: request.operationName,
            variables: request.variables,
            extensions: request.extensions,
            context: requestContext.context,
            persistedQueryHit: metrics.persistedQueryHit,
            persistedQueryRegister: metrics.persistedQueryRegister,
            requestContext: requestContext,
        });
        try {
            if (config.documentStore) {
                try {
                    requestContext.document = yield config.documentStore.get(queryHash);
                }
                catch (err) {
                    logger.warn('An error occurred while attempting to read from the documentStore. '
                        + (err && err.message) || err);
                }
            }
            if (!requestContext.document) {
                const parsingDidEnd = yield dispatcher.invokeDidStartHook('parsingDidStart', requestContext);
                try {
                    performanceTest.mark(parseMark);
                    requestContext.document = parse(query, config.parseOptions);
                    performanceTest.measure("parse", parseMark);

                    parsingDidEnd();
                }
                catch (syntaxError) {
                    parsingDidEnd(syntaxError);
                    return yield sendErrorResponse(syntaxError, apollo_server_errors_1.SyntaxError);
                }
                const validationDidEnd = yield dispatcher.invokeDidStartHook('validationDidStart', requestContext);
                const validationErrors = validate(requestContext.document);
                if (validationErrors.length === 0) {
                    validationDidEnd();
                }
                else {
                    validationDidEnd(validationErrors);
                    return yield sendErrorResponse(validationErrors, apollo_server_errors_1.ValidationError);
                }
                if (config.documentStore) {
                    Promise.resolve(config.documentStore.set(queryHash, requestContext.document)).catch(err => logger.warn('Could not store validated document. ' +
                        (err && err.message) || err));
                }
            }
            const operation = graphql_1.getOperationAST(requestContext.document, request.operationName);
            requestContext.operation = operation || undefined;
            requestContext.operationName =
                (operation && operation.name && operation.name.value) || null;
            try {
                yield dispatcher.invokeHookAsync('didResolveOperation', requestContext);
            }
            catch (err) {
                if (err instanceof runHttpQuery_1.HttpQueryError) {
                    const graphqlError = new graphql_1.GraphQLError(err.message);
                    graphqlError.stack = err.stack;
                    yield didEncounterErrors([graphqlError]);
                    throw err;
                }
                return yield sendErrorResponse(err);
            }
            if (metrics.persistedQueryRegister && persistedQueryCache) {
                Promise.resolve(persistedQueryCache.set(queryHash, query, config.persistedQueries &&
                    typeof config.persistedQueries.ttl !== 'undefined'
                    ? {
                        ttl: config.persistedQueries.ttl,
                    }
                    : Object.create(null))).catch(logger.warn);
            }

            performanceTest.mark(responseForOperationMark + '-' + requestContext.operationName);
            let response = yield dispatcher.invokeHooksUntilNonNull('responseForOperation', requestContext);
            performanceTest.measure("responseForOperation", responseForOperationMark + '-' + requestContext.operationName);


            if (response == null) {
                const executionListeners = [];
                dispatcher.invokeHookSync('executionDidStart', requestContext).forEach(executionListener => {
                    if (typeof executionListener === 'function') {
                        executionListeners.push({
                            executionDidEnd: executionListener,
                        });
                    }
                    else if (typeof executionListener === 'object') {
                        executionListeners.push(executionListener);
                    }
                });
                const executionDispatcher = new dispatcher_1.Dispatcher(executionListeners);
                const invokeWillResolveField = (...args) => executionDispatcher.invokeDidStartHook('willResolveField', ...args);
                Object.defineProperty(requestContext.context, schemaInstrumentation_1.symbolExecutionDispatcherWillResolveField, { value: invokeWillResolveField });
                if (config.fieldResolver) {
                    Object.defineProperty(requestContext.context, schemaInstrumentation_1.symbolUserFieldResolver, { value: config.fieldResolver });
                }
                //TEST 5
                performanceTest.mark(enablePluginsMark + '-' + requestContext.operationName);
                schemaInstrumentation_1.enablePluginsForSchemaResolvers(config.schema);
                performanceTest.measure("enablePluginsForSchemaResolvers", enablePluginsMark + '-' + requestContext.operationName);

                try {
                    //console.log(`>>> httpExecute`)
                    const executeHttpMark = "executeHttp-" + requestContext.operationName;
                    performanceTest.mark(executeHttpMark);
                    const result = yield execute(requestContext);
                    performanceTest.measure(executeHttpMark, executeHttpMark);

                    if (result.errors) {
                        yield didEncounterErrors(result.errors);
                    }
                    response = Object.assign(Object.assign({}, result), { errors: result.errors ? formatErrors(result.errors) : undefined });
                    executionDispatcher.reverseInvokeHookSync("executionDidEnd");
                }
                catch (executionError) {
                    executionDispatcher.reverseInvokeHookSync("executionDidEnd", executionError);
                    return yield sendErrorResponse(executionError);
                }
            }
            const formattedExtensions = extensionStack.format();
            if (Object.keys(formattedExtensions).length > 0) {
                response.extensions = formattedExtensions;
            }
            if (config.formatResponse) {

                //performanceTest.mark(`${test9}-${requestContext.operationName}`);
                const formattedResponse = config.formatResponse(response, requestContext);
                //performanceTest.measure(`${test9}-${requestContext.operationName}`, `${test9}-${requestContext.operationName}`);

                if (formattedResponse != null) {
                    response = formattedResponse;
                }
            }
            return sendResponse(response);
        }
        finally {
            requestDidEnd();
        }
        function parse(query, parseOptions) {
            const parsingDidEnd = extensionStack.parsingDidStart({
                queryString: query,
            });
            try {
                return graphql_1.parse(query, parseOptions);
            }
            finally {
                parsingDidEnd();
            }
        }
        function validate(document) {
            let rules = graphql_1.specifiedRules;
            if (config.validationRules) {
                rules = rules.concat(config.validationRules);
            }
            const validationDidEnd = extensionStack.validationDidStart();
            try {
                return graphql_1.validate(config.schema, document, rules);
            }
            finally {
                validationDidEnd();
            }
        }
        function execute(requestContext) {
            return __awaiter(this, void 0, void 0, function* () {
                const { request, document } = requestContext;
                const executionArgs = {
                    schema: config.schema,
                    document,
                    rootValue: typeof config.rootValue === 'function'
                        ? config.rootValue(document)
                        : config.rootValue,
                    contextValue: requestContext.context,
                    variableValues: request.variables,
                    operationName: request.operationName,
                    fieldResolver: config.fieldResolver,
                };
                const executionDidEnd = extensionStack.executionDidStart({
                    executionArgs,
                });
                try {
                    if (config.executor) {
                        console.log('executor 1')
                        return yield config.executor(requestContext);
                    }
                    else {
                        console.log('executor 2')
                        //  console.log(Object.keys(executionArgs));
                        //console.log(JSON.stringify(executionArgs));

                        //console.log(Object.keys(requestContext));
                        //console.log(`Requst context:  ${JSON.stringify(requestContext)}`);

                        //console.log(`Requst context operation:  ${JSON.stringify(requestContext.operation)}`);
                        //console.log(`Requst context document:  ${JSON.stringify(requestContext.document)}`);
                        //console.log(`Requst operation name:  ${JSON.stringify(requestContext.operationName)}`);


                        //console.log(schema)
                        //console.log(executionArgs.document)
                        //console.log(executionArgs.rootValue)
                        //console.log(executionArgs.contextValue)
                        //console.log(executionArgs.variableValues)
                        // console.log(executionArgs.operationName)

                        return yield graphql_1.execute(executionArgs);
                    }
                }
                finally {
                    executionDidEnd();
                }
            });
        }
        //TODO - undo this
        function sendResponse(response) {
            return __awaiter(this, void 0, void 0, function* () {
                const sendResponseExecuteMark = "sendResponseExecute-" + requestContext.operationName;
                performanceTest.mark(sendResponseExecuteMark);
                const result = yield execute(requestContext);
                performanceTest.measure(sendResponseExecuteMark, sendResponseExecuteMark);


                requestContext.response = extensionStack.willSendResponse({
                    graphqlResponse: Object.assign(Object.assign({}, requestContext.response), { errors: response.errors, data: response.data, extensions: response.extensions }),
                    context: requestContext.context,
                }).graphqlResponse;

                const willSendResponseMark = "willSendResponse-" + requestContext.operationName;
                performanceTest.mark(willSendResponseMark);
                yield dispatcher.invokeHookAsync('willSendResponse', requestContext);
                performanceTest.measure(willSendResponseMark, willSendResponseMark);

                return requestContext.response;
            });
        }
        function emitErrorAndThrow(error) {
            return __awaiter(this, void 0, void 0, function* () {
                yield didEncounterErrors([error]);
                throw error;
            });
        }
        function didEncounterErrors(errors) {
            return __awaiter(this, void 0, void 0, function* () {
                requestContext.errors = errors;
                extensionStack.didEncounterErrors(errors);
                return yield dispatcher.invokeHookAsync('didEncounterErrors', requestContext);
            });
        }
        function sendErrorResponse(errorOrErrors, errorClass) {
            return __awaiter(this, void 0, void 0, function* () {
                const errors = Array.isArray(errorOrErrors)
                    ? errorOrErrors
                    : [errorOrErrors];
                yield didEncounterErrors(errors);
                return sendResponse({
                    errors: formatErrors(errors.map(err => apollo_server_errors_1.fromGraphQLError(err, errorClass && {
                        errorClass,
                    }))),
                });
            });
        }
        function formatErrors(errors) {
            return apollo_server_errors_1.formatApolloErrors(errors, {
                formatter: config.formatError,
                debug: requestContext.debug,
            });
        }
        function initializeRequestListenerDispatcher() {
            const requestListeners = [];
            if (config.plugins) {
                for (const plugin of config.plugins) {
                    if (!plugin.requestDidStart)
                        continue;
                    const listener = plugin.requestDidStart(requestContext);
                    if (listener) {
                        requestListeners.push(listener);
                    }
                }
            }
            return new dispatcher_1.Dispatcher(requestListeners);
        }
        function initializeExtensionStack() {
            graphql_extensions_1.enableGraphQLExtensions(config.schema);
            const extensions = config.extensions ? config.extensions.map(f => f()) : [];
            const hasOwn = Object.prototype.hasOwnProperty;
            extensions.forEach((extension) => {
                if (!extension.constructor ||
                    hasOwn.call(extension.constructor, symbolExtensionDeprecationDone)) {
                    return;
                }
                Object.defineProperty(extension.constructor, symbolExtensionDeprecationDone, { value: true });
                const extensionName = extension.constructor.name;
                logger.warn('[deprecated] ' +
                    (extensionName
                        ? 'A "' + extensionName + '" '
                        : 'An anonymous extension ') +
                    'was defined within the "extensions" configuration for ' +
                    'Apollo Server.  The API on which this extension is built ' +
                    '("graphql-extensions") is being deprecated in the next major ' +
                    'version of Apollo Server in favor of the new plugin API.  See ' +
                    'https://go.apollo.dev/s/plugins for the documentation on how ' +
                    'these plugins are to be defined and used.');
            });
            return new graphql_extensions_1.GraphQLExtensionStack(extensions);
        }
        function initializeDataSources() {
            return __awaiter(this, void 0, void 0, function* () {
                if (config.dataSources) {
                    const context = requestContext.context;
                    const dataSources = config.dataSources();
                    const initializers = [];
                    for (const dataSource of Object.values(dataSources)) {
                        if (dataSource.initialize) {
                            initializers.push(dataSource.initialize({
                                context,
                                cache: requestContext.cache,
                            }));
                        }
                    }
                    yield Promise.all(initializers);
                    if ('dataSources' in context) {
                        throw new Error('Please use the dataSources config option instead of putting dataSources on the context yourself.');
                    }
                    context.dataSources = dataSources;
                }
            });
        }
    });
}
exports.processGraphQLRequest = processGraphQLRequest;
//# sourceMappingURL=requestPipeline.js.map