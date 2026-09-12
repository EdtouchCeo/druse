import handlers from './_lib/handlers/counseling-cases.js';
import web from './_lib/counseling-web.js';
export default web.fromHandler(handlers.handler);
