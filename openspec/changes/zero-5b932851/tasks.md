# Tasks

## 1. Implementación

- [x] 1.1 In package.json, line 4, replace the value of `description` with: An open source software factory that runs on your machine: it turns requests into delivered changes, and you decide where to step back in. Touch no other field and do not touch package-lock.json.
- [x] 1.2 In test/docs.test.ts, inside `describe("motto")`, add a test that parses package.json with the file's `read` helper and `JSON.parse`, then asserts that `description` equals the new sentence, does not match /kaelen/i and does not contain 'Zero human intervention required'. Do not check `name`, which remains `@kaelen/zero`.
- [x] 1.3 Run `npm run typecheck`, `npm test` and `npx openspec validate --all`.
