---
name: performance
description: Checklist of known performance problems in web apps (unpaginated or unindexed queries, N+1, no caching, static files without CDN, unoptimized images, a single JavaScript bundle, heavy work inside the request), each with how to detect it in code, how to fix it and its official sources.
---

# Performance checklist

Apps written quickly, by people or by agents, tend to be slow for the same known reasons. This skill lists them as controls. Use it to avoid them while writing code, to review a change, or to audit a repository.

How to use it:
- Judge only code that exists. Cite the file and line where the problem is, and give the concrete fix for that code (the query, the component, the route), not a general recommendation.
- In a review, flag only what the change adds or makes worse; what was already there belongs to an audit.
- Scale the severity to the real effect on realistic data and traffic. `high` or `critical` are for problems that will clearly hurt users or the service in normal use (a query over a whole growing table on every request, a loop of queries on a list page, a blocking task of seconds inside a request). Small or speculative gains are `low` or `medium`.
- Prefer the idiom of the framework the project already uses; never add a new dependency just to follow a control when the framework has its own way.
- Each control names its sources: official documentation, so the fix follows what the framework recommends.

## Controls

### PERF-01: Unpaginated queries
- **Detect:** List endpoints, pages or loaders that read a whole table or collection: `findMany()`/`find()` without `take`/`limit`, `Model.objects.all()` passed straight to a template or serializer, `Model.all` in Rails, `SELECT` without `LIMIT`, or a client that downloads everything and filters or pages in the browser. Large `OFFSET` values on deep pages count too.
- **Fix:** Page every list on the server with a bounded default and maximum page size (`LIMIT`/`take`, Django's `Paginator`, Rails `limit`/`offset`). For large or deep lists use keyset (cursor) pagination: `WHERE (created_at, id) < ($1, $2) ORDER BY created_at DESC, id DESC LIMIT 50`, with an index on the sort key.
- **Sources:** https://www.postgresql.org/docs/current/queries-limit.html, https://docs.djangoproject.com/en/stable/topics/pagination/, https://guides.rubyonrails.org/active_record_querying.html

### PERF-02: Missing indexes
- **Detect:** Columns used in `WHERE`, `JOIN`, `ORDER BY` or foreign keys without an index in the schema or migrations; lookups by email, slug, status or owner id on tables that grow; `EXPLAIN` showing a sequential scan on a large table; `LIKE '%term%'` searches on big text columns.
- **Fix:** Add an index (in a migration) that matches the filter and the sort, a composite one in the order the query uses (`CREATE INDEX ON orders (customer_id, created_at DESC)`); index foreign keys; use a partial index for a hot subset and a full-text or trigram index for text search. Check with `EXPLAIN ANALYZE`. On a live table create it with `CREATE INDEX CONCURRENTLY`.
- **Sources:** https://www.postgresql.org/docs/current/indexes.html, https://www.postgresql.org/docs/current/using-explain.html, https://docs.djangoproject.com/en/stable/ref/models/indexes/

### PERF-03: N+1 queries
- **Detect:** A query inside a loop, a `map` or a template iteration: `for (const post of posts) await db.user.findUnique(...)`, `post.author` read per item in Django or Rails without eager loading, a GraphQL resolver that queries per parent, `await` of a fetch per row.
- **Fix:** Load the related data in one query: a join or `include` (Prisma), `select_related`/`prefetch_related` (Django), `includes`/`preload` (Rails), one `WHERE id = ANY($1)` query and a map by id, or a batching loader for resolvers. Independent requests run together with `Promise.all`.
- **Sources:** https://docs.djangoproject.com/en/stable/topics/db/optimization/, https://docs.djangoproject.com/en/stable/ref/models/querysets/, https://guides.rubyonrails.org/active_record_querying.html

### PERF-04: No caching
- **Detect:** The same expensive query, computation or external API call repeated on every request with the same result: data that changes rarely (settings, catalogs, public pages) read fresh each time, Next.js fetches or routes opted out of caching (`cache: 'no-store'`, `dynamic = 'force-dynamic'`) without a reason, no `Cache-Control` on cacheable API answers.
- **Fix:** Cache at the right level with an explicit invalidation: the framework's data cache and revalidation (`revalidate`, tags) in Next.js, Django's cache framework (per view, template fragment or low level), Rails fragment and low-level caching, or a shared store such as Redis for several instances; send `Cache-Control` (and `ETag`) on answers that can be cached.
- **Sources:** https://nextjs.org/docs/app/building-your-application/caching, https://docs.djangoproject.com/en/stable/topics/cache/, https://guides.rubyonrails.org/caching_with_rails.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching

### PERF-05: Static assets without a CDN or cache headers
- **Detect:** JavaScript, CSS, fonts and images served by the application process (`express.static` without `maxAge`, a Django or Rails app serving its own assets in production), files without content hashes in their names, answers without `Cache-Control` or with `no-cache` on versioned files, no CDN in front of public assets.
- **Fix:** Build fingerprinted file names and serve them with `Cache-Control: public, max-age=31536000, immutable`; HTML gets a short or revalidated cache. Put static files behind a CDN or the platform's static hosting (Next.js `public/` and `_next/static`, Rails asset pipeline with `asset_host`, Django `collectstatic` with a static file server or CDN).
- **Sources:** https://web.dev/articles/http-cache, https://web.dev/articles/content-delivery-networks, https://expressjs.com/en/advanced/best-practice-performance.html, https://docs.djangoproject.com/en/stable/howto/static-files/deployment/

### PERF-06: Unoptimized images
- **Detect:** Large JPEG or PNG files committed or uploaded and served as is, `<img>` without `width`/`height` (layout shift), no `srcset`/`sizes` for different screens, every image loaded eagerly, a plain `<img>` in a Next.js app instead of `next/image`, the main (LCP) image lazy loaded.
- **Fix:** Serve modern formats (AVIF/WebP) resized to the displayed size with `srcset` and `sizes`; set `width` and `height`; add `loading="lazy"` below the fold and `fetchpriority="high"` on the LCP image; in Next.js use `next/image` (with `priority` for the LCP image); resize uploads on the server or through an image service.
- **Sources:** https://web.dev/learn/images, https://nextjs.org/docs/app/api-reference/components/image, https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img

### PERF-07: A single JavaScript bundle without code splitting
- **Detect:** Every route and heavy component imported statically from the entry point, large libraries (charts, editors, maps, date or icon packs) imported whole on pages that rarely need them, a client bundle over a few hundred kilobytes, a whole Next.js page marked `'use client'` when only a part is interactive.
- **Fix:** Split by route and load heavy parts on demand: dynamic `import()`, `React.lazy` with `Suspense`, `next/dynamic`; import only what is used (`import debounce from 'lodash/debounce'`); keep server components on the server in Next.js and push `'use client'` down to the interactive leaves; check the result with the bundler's analyzer.
- **Sources:** https://web.dev/articles/reduce-javascript-payloads-with-code-splitting, https://react.dev/reference/react/lazy, https://vite.dev/guide/features, https://nextjs.org/docs/app/building-your-application/optimizing/lazy-loading

### PERF-08: Heavy work inside the request instead of a background queue
- **Detect:** A request handler that sends emails, generates PDFs or reports, processes images or video, calls slow third-party APIs in sequence, imports files or runs long loops before answering; webhooks that do all the work before returning; CPU-heavy synchronous code in a Node.js handler.
- **Fix:** Answer fast and move the work to a background job (Rails Active Job, a task queue for Django, a queue with workers for Node.js), returning `202 Accepted` and a status to poll when the user needs the result; for short follow-up work in Next.js use `after`. Move CPU-bound work in Node.js to worker threads.
- **Sources:** https://guides.rubyonrails.org/active_job_basics.html, https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop, https://nextjs.org/docs/app/api-reference/functions/after, https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/202

### PERF-09: Blocking the event loop with synchronous calls
- **Detect:** `fs.readFileSync`, `execSync`, `crypto.pbkdf2Sync`, `zlib.*Sync` or large `JSON.parse`/`JSON.stringify` inside request handlers in Node.js; regular expressions open to catastrophic backtracking applied to user input.
- **Fix:** Use the asynchronous APIs (`fs/promises`, `crypto.pbkdf2`), stream large bodies, read configuration once at start-up, move CPU-bound work to worker threads, and write regular expressions without nested quantifiers.
- **Sources:** https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop, https://expressjs.com/en/advanced/best-practice-performance.html

### PERF-10: Answers without compression
- **Detect:** A Node.js or Express server that sends HTML, JSON, JavaScript or CSS without gzip or Brotli and no proxy or CDN in front that compresses; `Content-Encoding` missing on text answers.
- **Fix:** Compress at the reverse proxy or CDN (preferred) or in the app (the `compression` middleware in Express, `GZipMiddleware` in Django); ship pre-compressed static files when the build can make them.
- **Sources:** https://expressjs.com/en/advanced/best-practice-performance.html, https://developer.mozilla.org/en-US/docs/Web/HTTP/Compression, https://docs.djangoproject.com/en/stable/ref/middleware/

### PERF-11: Reading more data than needed
- **Detect:** `SELECT *` or whole models loaded to use one or two fields, large text or JSON columns read in list views, counting by loading rows (`len(queryset)`, `records.length` after loading everything), existence checks that load the record.
- **Fix:** Select only the needed columns (`select` in Prisma, `only`/`values` in Django, `select`/`pluck` in Rails); count and check existence in the database (`COUNT(*)`, `.count()`, `.exists()`/`exists?`).
- **Sources:** https://docs.djangoproject.com/en/stable/ref/models/querysets/, https://guides.rubyonrails.org/active_record_querying.html, https://www.postgresql.org/docs/current/queries-select-lists.html

### PERF-12: Writes one row at a time in a loop
- **Detect:** `INSERT` or `UPDATE` per item inside a loop, `save()`/`create()` per element of an import, each in its own transaction.
- **Fix:** Write in bulk: a multi-row `INSERT`, `COPY` for large loads, `bulk_create`/`bulk_update` in Django, `insert_all`/`upsert_all` in Rails, `createMany` in Prisma, inside one transaction.
- **Sources:** https://www.postgresql.org/docs/current/populate.html, https://docs.djangoproject.com/en/stable/ref/models/querysets/, https://guides.rubyonrails.org/active_record_querying.html

### PERF-13: A new database connection per request
- **Detect:** A database client created inside a request handler or a serverless function body (`new Pool()`, `new PrismaClient()` per call), Django `CONN_MAX_AGE` at 0 under load, pools larger than what the database accepts.
- **Fix:** Create one client or pool per process and reuse it (a module-level singleton, also across hot reloads in development); size the pool to the database's `max_connections`; use persistent connections in Django and the pool setting in Rails; put a connection pooler in front for serverless.
- **Sources:** https://www.postgresql.org/docs/current/runtime-config-connection.html, https://docs.djangoproject.com/en/stable/ref/databases/, https://guides.rubyonrails.org/configuring.html

### PERF-14: Data fetching waterfalls
- **Detect:** Independent `await`s one after the other in a server component, loader or handler; components that fetch only after the parent rendered (fetch in `useEffect` chains); the whole page waiting for its slowest part.
- **Fix:** Start independent requests together (`Promise.all`), fetch on the server where the framework allows it, and stream slow parts with `Suspense` and loading states so the rest of the page shows first.
- **Sources:** https://nextjs.org/docs/app/building-your-application/data-fetching/fetching, https://react.dev/reference/react/Suspense, https://web.dev/articles/optimize-lcp

### PERF-15: Render-blocking resources and fonts
- **Detect:** Synchronous `<script>` tags in `<head>` without `defer` or `async`, large CSS files for the whole site on every page, web fonts from a third-party host without `font-display`, third-party scripts (analytics, chat, ads) loaded before the content.
- **Fix:** Add `defer` (or `async` for independent scripts), load third-party scripts after the page is interactive (`next/script` with `strategy="lazyOnload"`), inline critical CSS or split it per page, self-host fonts with `font-display: swap` (`next/font` in Next.js) and preload only the critical ones.
- **Sources:** https://web.dev/articles/optimize-lcp, https://nextjs.org/docs/app/building-your-application/optimizing/fonts, https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script

### PERF-16: Long lists and needless re-renders on the client
- **Detect:** Thousands of rows rendered at once, expensive computations repeated on every render, context providers whose value is a new object on each render, state kept high in the tree so every keystroke re-renders the page.
- **Fix:** Page or virtualize long lists (render only the visible rows), memoize expensive values and components where profiling shows the cost (`useMemo`, `memo`), keep state close to where it is used and keep context values stable.
- **Sources:** https://web.dev/articles/virtualize-long-lists-react-window, https://react.dev/reference/react/memo, https://react.dev/reference/react/useMemo
