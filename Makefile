SHELL := /bin/bash
IOS_DIR := apps/ios
IOS_SCHEME := Irlo
# Default verified against `xcrun simctl list devices available` on this machine
# (2026-07-10); override per machine/CI: make test-ios IOS_SIM_DEVICE="iPhone 17 Pro" IOS_SIM_OS=latest
IOS_SIM_DEVICE ?= iPhone 16 Pro
IOS_SIM_OS ?= 18.0
IOS_DEST := platform=iOS Simulator,name=$(IOS_SIM_DEVICE),OS=$(IOS_SIM_OS)
# Extra xcodebuild args (e.g. CI passes -resultBundlePath for artifacts/coverage)
IOS_TEST_EXTRA_ARGS ?=

.PHONY: bootstrap test test-server test-ios lint media

bootstrap: ## Install pinned toolchain and workspace dependencies
	mise install
	brew bundle check --no-upgrade || brew bundle
	pnpm install
	cd $(IOS_DIR) && xcodegen generate

test: test-server test-ios ## Run every test suite

test-server: ## Server + contracts (Vitest)
	pnpm -r test

test-ios: ## iOS unit + UI canaries (XCTest/XCUITest)
	cd $(IOS_DIR) && xcodegen generate && xcodebuild \
		-project Irlo.xcodeproj \
		-scheme $(IOS_SCHEME) \
		-destination '$(IOS_DEST)' \
		test $(IOS_TEST_EXTRA_ARGS)

lint: ## Lint all workspaces
	pnpm -r lint
	cd $(IOS_DIR) && swiftlint

media: ## Capture evidence media (pipeline lands in Stage 1+)
	@echo "make media: evidence pipeline arrives with Stage 1+ (see docs/media/README.md)"
