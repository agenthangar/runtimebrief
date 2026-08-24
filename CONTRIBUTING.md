# Contributing

Issues and pull requests are welcome. Keep changes focused and explain their
effect on the daemon, iOS client, protocol, or security model.

## Development checks

For the daemon:

```sh
cd daemon
npm ci
npm test
npm run build
```

For iOS, install XcodeGen, generate the project from `ios/project.yml`, and run
the `RuntimeBriefTests` suite in a current iOS Simulator. Contributors must use
their own Apple development team for device builds; signing configuration and
credentials must never be committed.

Security-sensitive changes should include tests. Do not use real transcripts,
tokens, filesystem paths, or private repository content as fixtures.
