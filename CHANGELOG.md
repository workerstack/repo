# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Agents never change product files in the main checkout: the gate denies a write, a commit, destructive git and a lesson save there, and a force push, a delete of the default branch or another session's `wt/*`, unless the user's message names the git command. Work starts with `worktree.mjs add <name>`, and the new `worktree.mjs finish [<name>]` rebases the branch onto the default branch, fast-forwards it and removes the worktree, without pushing. `repo doctor` lists a `stale worktree` unmerged for 7 days
