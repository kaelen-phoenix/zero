# Spec Delta

## ADDED Requirements

### Requirement: Spec may split a request into stages
The spec station's output SHALL accept an optional `stages` list, each stage with a `title` and its `tasks`, and `specProblems` MUST reject a feasible spec whose `stages` list is present but has fewer than 2 stages, more than 8 (`MAX_STAGES`), a stage with an empty title, or a stage without tasks.

#### Scenario: Valid stages accepted
- **WHEN** specProblems receives a feasible spec with two stages, each with a non-empty title and at least one task
- **THEN** it returns no problems

#### Scenario: Single stage rejected
- **WHEN** specProblems receives a feasible spec whose stages list has exactly one stage
- **THEN** it returns a problem mentioning stages

#### Scenario: Too many stages rejected
- **WHEN** specProblems receives a feasible spec with 9 stages, each with a title and a task
- **THEN** it returns a problem saying stages must be at most 8

#### Scenario: Stage without tasks rejected
- **WHEN** specProblems receives a feasible spec with two stages where one has an empty tasks list
- **THEN** it returns a problem naming that stage

#### Scenario: No stages is still valid
- **WHEN** specProblems receives a feasible spec without a stages field, as stored before this change
- **THEN** it returns no stage problems

### Requirement: Staged tasks rendered per stage
When a spec has stages, `renderOpenSpecChange` MUST write tasks.md with one numbered section per stage, in order, titled with the stage's title and listing that stage's tasks.

#### Scenario: Two stages in tasks.md
- **WHEN** renderOpenSpecChange renders a spec with stages "Base" (tasks a, b) and "Vista" (task c)
- **THEN** tasks.md has a section 1 titled with "Base" holding 1.1 a and 1.2 b, followed by a section 2 titled with "Vista" holding 2.1 c

### Requirement: Spec instructions ask to split large requests
The spec station's instructions (agents/spec.md) SHALL tell the agent to split a request with many tasks or many areas of the code into `stages`, each small enough for one build call within its time limit, and to leave `stages` out for small requests.

#### Scenario: Instructions mention stages
- **WHEN** agents/spec.md is read
- **THEN** it mentions the `stages` field and says when to use it

### Requirement: Stages are built and verified one after another
For a spec with stages, the runner MUST run build (and the line's writing agents) and then verify for each stage in order, in the job's work copy. Each stage's build prompt MUST name the stage number, the total, the stage's title and its tasks. Dependencies, review, security and the reviewing agents MUST run only once, after the last stage passes verify.

#### Scenario: Three stages, all pass
- **WHEN** a job runs with a fake agent and a spec of 3 stages whose builds all change code and whose verify passes
- **THEN** build is called 3 times with prompts naming stage 1 of 3, 2 of 3 and 3 of 3 with their titles, verify runs after each, and review and security each run once, after the third build

### Requirement: Verified stage progress is kept
When a stage passes verify, the runner MUST record it on the job (`stagesDone`, persisted in the store), commit its work, reset the attempt count and clear the feedback. A later failure of the next stage, including a build call that ends abnormally or by timeout, MUST retry only that stage on top of the earlier stages' commits, without building the earlier stages again.

#### Scenario: Second stage times out once
- **WHEN** in a 2-stage job, stage 1 passes verify and the first build call of stage 2 returns ok false with a timeout message
- **THEN** the next build call is for stage 2 of 2, stage 1 is not built again, the stage 1 commit is still in the branch, and the job records stagesDone 1

#### Scenario: Progress survives in the store
- **WHEN** stage 1 of a 2-stage job passes verify
- **THEN** store.getJob returns stagesDone 1 and attempt reset so the next build is attempt 1 of stage 2

### Requirement: Attempts are counted per stage
In a staged job, `maxAttempts` MUST apply to each stage separately. When a stage uses them all, the job MUST fail with a reason that names the stage (number and title) and the last problem.

#### Scenario: Stage exhausts its attempts
- **WHEN** a line with maxAttempts 2 runs a 2-stage job where stage 1 passes and stage 2 fails verify twice
- **THEN** the job ends failed with a reason naming stage 2 and its title, after exactly 2 build calls for stage 2

### Requirement: Interrupted staged job resumes at its stage
A staged job requeued after an interruption (shutdown or network retry) MUST resume at the first stage not yet verified, using the recorded `stagesDone`.

#### Scenario: Resume after shutdown
- **WHEN** a 3-stage job with stagesDone 2 is requeued and runs again
- **THEN** the first build call it makes is for stage 3 of 3

### Requirement: Unstaged jobs keep today's flow
A job whose spec has no stages MUST run build, verify, review and security exactly as before this change, and its build prompt MUST NOT mention stages.

#### Scenario: Plain spec
- **WHEN** a job runs with a spec without stages
- **THEN** build is called once per attempt, the prompt contains no stage text and review runs after verify as today

### Requirement: Status shows the stage
`describeJobStatus` MUST append the current stage as `etapa <n> de <total>` for a running job whose spec has stages, where n is stagesDone plus 1 and is never more than the total.

#### Scenario: Running staged job
- **WHEN** describeJobStatus gets a running job at station build, attempt 1, with a 4-stage spec and stagesDone 1
- **THEN** the text contains "etapa 2 de 4"

#### Scenario: Unstaged job
- **WHEN** describeJobStatus gets a running job whose spec has no stages
- **THEN** the text contains no "etapa"

### Requirement: Panel line view shows the stage
The panel's production line row (`lineRow`, fed by the job data in app.ts) MUST show `etapa <n> de <total>` and the current stage's title for an unfinished job whose spec has stages, and nothing about stages for unstaged jobs.

#### Scenario: Staged job row
- **WHEN** /line is rendered with a running job whose spec has 3 stages and stagesDone 0
- **THEN** the job's article contains "etapa 1 de 3" and the first stage's title (HTML-escaped)

#### Scenario: Unstaged job row
- **WHEN** /line is rendered with a running job without stages
- **THEN** the job's article contains no "etapa"

### Requirement: Stages documented in both READMEs
README.md and README.es.md MUST each explain staged requests (how big requests are split, that verified stages are kept, that attempts count per stage, and where to see the stage), with the same structure so `test/docs.test.ts` passes.

#### Scenario: Docs mention stages
- **WHEN** README.md and README.es.md are read
- **THEN** README.md describes stages and README.es.md describes etapas, and the docs test passes
