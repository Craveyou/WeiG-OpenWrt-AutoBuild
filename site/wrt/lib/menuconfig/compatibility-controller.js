/*
 * SPDX-FileCopyrightText: 2026 weigefenxiang <weigefenxiang@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Conflict handling and compatibility recommendation presentation over the shared Kconfig runtime.
 */
'use strict';

function kconfigRequirementText(requirements = []) {
  return displayText(requirements.map((group) => (group || []).filter(Boolean).join(' && ')).filter(Boolean).join(' || '));
}

function displayCompatibilityIdentity(violation = {}) {
  if (violation.symbol) return displayConfigSymbol(violation.symbol, { kind: 'config' });
  if (violation.package) return displayPackageName(violation.package);
  return displayText(violation.code || 'configuration-invalid');
}
function displayCompatibilityDetail(violation = {}) {
  if (violation.code === 'package-conflict') {
    const providers = [violation.otherPackage, ...(violation.otherPackages || [])]
      .filter(Boolean).map(displayPackageName);
    return displayText(`${violation.capability || 'conflict'}: ${providers.join(' || ') || 'unknown provider'}`);
  }
  return displayText(violation.dependency || violation.code || 'configuration-invalid');
}

// Recommendations are an explicit, revision-scoped view over the existing engine.
// No ordinary edit invokes this planner or an installation/compatibility scan.
let catalogDependencyDetails = null;
let catalogDependencyDetailsKey = '';
const catalogDependencyDetailsCache = new Map();
function catalogDependencyAnalysis(option) {
  const key = `${menuCatalogKey}:${catalogStateRevision}`;
  if (catalogDependencyDetailsKey !== key) {
    catalogDependencyDetailsCache.clear(); catalogDependencyDetailsKey = key;
  }
  if (catalogDependencyDetailsCache.has(option.symbol)) return catalogDependencyDetailsCache.get(option.symbol);
  const context = catalogValidationContext(menuValues, 'interactive');
  const record = CATALOG_MODEL.bySymbol.get(option.symbol);
  const constraints = optionStateConstraints(option);
  const intent = {
    symbol: option.symbol, value: 'y', skipPrerequisitePlanning: true,
    dependencySymbols: catalogDependencySymbols, protectedSymbols: catalogProtectedSymbols(),
    explicitSymbols: new Set([...catalogUserOverrides.keys(), ...catalogProtectedSymbols()]),
    preferredValues: catalogPreferredValues(), derivedSymbols: catalogConditionalDefaultSymbols,
    validationOptions: { ...context.validationOptions, scope: 'menuconfig' },
    planningBudget: { maxNodes: 128, timeMs: 250 },
  };
  let preview = null, plans = null, error = null;
  try { preview = CATALOG_ENGINE.applyUserIntent(CATALOG_MODEL, context.values, intent); }
  catch (failure) { error = failure; }
  if (!preview && !constraints.readOnly) {
    plans = CATALOG_ENGINE.deriveKconfigPrerequisitePlans(CATALOG_MODEL, context.values, record, 'y', intent);
  }
  const plan = plans?.recommended || null;
  const projected = preview || plan;
  const related = new Set([option.symbol, ...(projected?.changes || []).map(change => change.symbol)]);
  const installation = projected ? CATALOG_ENGINE.validateConfig(CATALOG_MODEL, projected.values, {
    ...context.validationOptions, deferred: 'error',
  }).filter(row => related.has(row.symbol) && String(row.code).startsWith('package-dependency-')) : [];
  // Cache presentation/operations, not thousands of effective value entries.
  // Applying always replays the shared engine against the current revision.
  const analysis = { constraints, error, installation,
    plan: plan ? { steps: plan.steps, automaticChanges: plan.automaticChanges } : null,
    preview: preview ? { changes: preview.changes } : null,
    revision: catalogStateRevision, catalogKey: menuCatalogKey };
  catalogDependencyDetailsCache.set(option.symbol, analysis);
  return analysis;
}
function closeCatalogDependencyDetails() {
  catalogDependencyDetails = null;
  document.querySelectorAll('.catalog-dependency-details').forEach(element => element.remove());
}
function openCatalogDependencyDetails(option, settings = {}) {
  if (!option || !CATALOG_MODEL) return false;
  const plugin = PLUGINS.plugins.find(p => curatedMenuOption(p)?.symbol === option.symbol);
  const analysis = settings.error ? { error: settings.error, constraints: settings.error.constraints,
    revision: catalogStateRevision, catalogKey: menuCatalogKey } : catalogDependencyAnalysis(option);
  catalogDependencyDetails = { option, group: plugin?.group, pluginId: plugin?.id,
    catalogKey: menuCatalogKey, analysis };
  renderCatalogDependencyDetails();
  return true;
}
function renderCatalogDependencyDetails() {
  document.querySelectorAll('.catalog-dependency-details').forEach(element => element.remove());
  if (!catalogDependencyDetails) return;
  if (catalogDependencyDetails.catalogKey !== menuCatalogKey) { closeCatalogDependencyDetails(); return; }
  const { option, group, pluginId, analysis } = catalogDependencyDetails;
  const plugin = PLUGINS.plugins.find(p => p.id === pluginId);
  const label = plugin ? pName(plugin) : displayConfigSymbol(option.symbol);
  const host = [...$('groups').querySelectorAll('.group')].find(element => element.dataset.group === group) ||
    $('menuconfigBody');
  if (!host) return;
  const panel = document.createElement('section');
  panel.className = 'compatibility-recommendation catalog-dependency-details';
  panel.id = 'catalogDependencyDetails';
  panel.setAttribute('aria-label', t('dependency.title'));
  const header = document.createElement('div');
  header.className = 'compatibility-recommendation-header';
  const heading = document.createElement('strong');
  heading.className = 'compatibility-recommendation-title';
  heading.textContent = `${t('dependency.title')} · ${label}`;
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'btn'; close.textContent = t('btn.close');
  close.onclick = closeCatalogDependencyDetails;
  header.append(heading, close); panel.appendChild(header);
  const line = (text, className = 'catalog-dependency-copy') => {
    const element = document.createElement('p');
    element.className = className; element.textContent = text; panel.appendChild(element);
    return element;
  };
  const locate = (symbol) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn';
    button.textContent = t('dependency.locate', { symbol: displayConfigSymbol(symbol, { kind: 'config' }) });
    button.onclick = () => focusMenuconfigSymbol(symbol).catch(error => showToast(displayText(error.message)));
    return button;
  };
  if (analysis.revision !== catalogStateRevision) {
    line(t('dependency.stale'));
    const refresh = document.createElement('button');
    refresh.type = 'button'; refresh.className = 'btn';
    refresh.textContent = t('dependency.refresh');
    refresh.onclick = () => openCatalogDependencyDetails(option);
    panel.appendChild(refresh);
  } else {
    const plan = analysis.plan;
    if (analysis.preview) line(t('dependency.noExtra'), 'catalog-dependency-action');
    else if (plan) {
      line(t('dependency.extra', { list: plan.steps.map(step =>
        `${displayConfigSymbol(step.symbol, { kind: 'config' })}=${step.value.toUpperCase()}`).join(' → ') }),
      'catalog-dependency-action');
    } else {
      line(t('dependency.restricted'), 'catalog-dependency-action');
      // The exact expression remains copyable on demand, not a forced modal.
      const requirement = kconfigRequirementText(analysis.constraints?.dependencyExpressions || []);
      if (requirement) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = t('dependency.requirement');
        const code = document.createElement('code'); code.textContent = requirement;
        details.append(summary, code); panel.appendChild(details);
      }
      if (analysis.error && !requirement) line(displayText(analysis.error.message));
    }
    const automatic = (analysis.preview?.changes || plan?.automaticChanges || [])
      .filter(change => change.symbol !== option.symbol && change.to !== 'n');
    if (automatic.length) line(t('dependency.automatic', { list: [...new Set(automatic.map(change =>
      `${displayConfigSymbol(change.symbol, { kind: 'config' })}=${String(change.to).toUpperCase()}`))].join(', ') }));
    for (const row of analysis.installation || []) line(t(row.reason === 'provider-absent'
      ? 'dependency.missing' : 'dependency.installation', { dependency: displayCompatibilityDetail(row) }));
    const actions = document.createElement('div');
    actions.className = 'catalog-dependency-actions';
    actions.appendChild(locate(plan?.steps[0]?.symbol || option.symbol));
    if (plan && !analysis.installation?.length) {
      const apply = document.createElement('button');
      apply.type = 'button'; apply.className = 'btn btn-primary';
      apply.textContent = t('dependency.apply');
      apply.onclick = () => {
        if (analysis.revision !== catalogStateRevision || analysis.catalogKey !== menuCatalogKey) {
          renderCatalogDependencyDetails(); return;
        }
        try {
          const assignments = new Map(plan.steps.map(step => [step.symbol, step.value]));
          applyCatalogIntent(option, 'y', false, 'user', assignments);
          closeCatalogDependencyDetails(); renderCatalogUiAfterIntent();
        } catch (error) { line(displayText(error.message)); }
      };
      actions.appendChild(apply);
    }
    panel.appendChild(actions);
  }
  host.appendChild(panel);
}

function configurationPreflightValues() {
  if (typeof buildFinalConfigText === 'function' && typeof ACTIVE_PROFILE_BASELINE !== 'undefined' &&
      ACTIVE_PROFILE_BASELINE && state.device?.id === 'catalog-target') {
    return CATALOG_ENGINE.parseConfigDocument(buildFinalConfigText());
  }
  return menuValues;
}

function configurationBlockingViolations(values = configurationPreflightValues()) {
  if (!CATALOG_MODEL || !CATALOG_ENGINE?.validateConfig) return [];
  const context = catalogValidationContext(values, 'preflight');
  return CATALOG_ENGINE.validateConfig(
    CATALOG_MODEL, context.values, { ...context.validationOptions, scope: 'menuconfig' },
  ).filter((item) => !item?.deferred && item?.warning !== true &&
    item?.code !== 'kconfig-select-warning');
}

function configurationViolationKey(item = {}) {
  if (item.code === 'package-conflict') {
    return `${item.code}:${[item.package, item.otherPackage, ...(item.otherPackages || [])]
      .filter(Boolean).sort().join(':')}:${item.capability || ''}`;
  }
  if (item.code === 'choice-conflict') {
    return `${item.code}:${item.choice || ''}:${[...(item.symbols || [])].sort().join(',')}`;
  }
  return `${item.code || 'configuration'}:${item.symbol || item.package || ''}:${item.dependency || ''}`;
}

function configurationPreflightEvaluation() {
  if (state.device?.id !== 'catalog-target' || !CATALOG_MODEL || !MENU_CATALOG) {
    return {
      context: null, initialViolations: [], actions: [], changes: [],
      values: new Map(menuValues), finalValues: new Map(menuValues), unresolved: [],
    };
  }
  const context = catalogValidationContext(configurationPreflightValues(), 'preflight');
  context.validationOptions = { ...context.validationOptions, scope: 'menuconfig' };
  const plan = CATALOG_ENGINE.deriveConfigurationRepairPlan(
    CATALOG_MODEL, context.values, {
      dependencySymbols: catalogDependencySymbols,
      derivedSymbols: catalogConditionalDefaultSymbols,
      protectedSymbols: catalogProtectedSymbols(),
      preferredValues: catalogPreferredValues(),
      explicitSymbols: catalogUserOverrides.keys(),
      disabledSymbols: [...menuTouched].filter((symbol) => (menuValues.get(symbol) ?? 'n') === 'n'),
      validationOptions: context.validationOptions,
    },
  );
  return { context, ...plan };
}

function configurationPreflightIdentity() {
  const source = selectedCatalogSource();
  const branch = selectedCatalogBranch(source);
  const identity = resolveCompatibilityIdentity(source, branch, MENU_CATALOG?.source);
  const target = state.device?.target || {};
  return {
    source: identity.sourceId,
    branch: identity.branchName,
    sourceCommit: identity.sourceCommit,
    target: [target.system, target.subtarget, target.profileSymbol || target.profile]
      .map((value) => String(value || '')).join('/'),
  };
}

function forcedConfigurationAudit(evaluation) {
  const forced = [...new Map((evaluation.initialViolations || [])
    .map((item) => [configurationViolationKey(item), {
      code: String(item.code || 'configuration-invalid'),
      ...(item.symbol ? { symbol: String(item.symbol) } : {}),
      ...(item.package ? { package: String(item.package) } : {}),
      ...(item.otherPackage ? { otherPackage: String(item.otherPackage) } : {}),
      ...(Array.isArray(item.otherPackages) && item.otherPackages.length ? {
        otherPackages: [...new Set(item.otherPackages.map((value) => String(value || '').trim()).filter(Boolean))].sort(),
      } : {}),
      ...(item.capability ? { capability: String(item.capability) } : {}),
      ...(item.condition ? { condition: String(item.condition) } : {}),
      ...((item.dependency || item.choice || item.otherPackage || (Array.isArray(item.otherPackages) && item.otherPackages.length)) ? {
        dependency: String(item.dependency || item.choice ||
          [item.package, item.otherPackage, ...(item.otherPackages || [])].filter(Boolean).sort().join(' || ')),
      } : {}),
    }])).values()].slice(0, 64);
  return forced.length ? { schema: 1, ...configurationPreflightIdentity(), forced } : null;
}

function configurationPreflightRows(evaluation) {
  const symbols = new Set();
  for (const action of evaluation.actions || []) {
    if (action.symbol) symbols.add(action.symbol);
    for (const step of action.steps || []) symbols.add(step.symbol);
  }
  for (const violation of (evaluation.initialViolations || []).slice(0, 18)) {
    if (violation.symbol) symbols.add(violation.symbol);
    for (const symbol of violation.symbols || []) symbols.add(symbol);
    for (const packageName of [violation.package, violation.otherPackage, ...(violation.packages || [])]) {
      const record = CATALOG_MODEL?.byPackage?.get(packageName);
      if (record?.configSymbol) symbols.add(record.configSymbol);
    }
    if (violation.code === 'kconfig-dependency-unsatisfied' && violation.symbol) {
      const record = CATALOG_MODEL?.bySymbol?.get(violation.symbol);
      const value = evaluation.context?.values?.get(violation.symbol) ?? 'n';
      const plans = record && ['bool', 'tristate'].includes(record.type) ? CATALOG_ENGINE.deriveKconfigPrerequisitePlans(
        CATALOG_MODEL, evaluation.context.values, record, value, {
          explicitSymbols: catalogUserOverrides.keys(),
          validationOptions: evaluation.context.validationOptions,
        },
      ) : null;
      for (const candidate of plans?.candidates || []) {
        for (const step of candidate.steps || []) symbols.add(step.symbol);
      }
    }
  }
  return [...symbols].slice(0, 18).map((symbol) => {
    const record = CATALOG_MODEL?.bySymbol?.get(symbol);
    const option = menuOptionBySymbol.get(symbol);
    return record && option ? { symbol, record, option } : null;
  }).filter(Boolean);
}

function configurationReviewChanges(before, after, manualSymbols = new Set()) {
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((symbol) => {
    const absent = ['int', 'hex', 'string'].includes(CATALOG_MODEL?.bySymbol?.get(symbol)?.type) ? null : 'n';
    const from = before.get(symbol) ?? absent, to = after.get(symbol) ?? absent;
    return from === to ? [] : [{ symbol, from, to, automatic: !manualSymbols.has(symbol) }];
  });
}
function appendConfigurationReview(body, changes, applied = false) {
  if (!changes.length) return;
  body.appendChild(UI_COMPONENTS.createUiConfigurationReview({
    title: t(applied ? 'configuration.reviewApplied' : 'configuration.reviewProposed'), changes,
    automaticTitle: t('configuration.reviewAutomatic'),
    formatSymbol: (symbol) => displayConfigSymbol(symbol, { kind: 'config' }),
    formatValue: (value) => value === null ? t('configuration.removeInactive') :
      ['n', 'm', 'y'].includes(value) ? value.toUpperCase() : String(value),
    formatKind: (change) => t(change.automatic ? 'configuration.reviewAutomatic' : 'configuration.reviewManual'),
  }));
}

function applyConfigurationRecommendation(evaluation) {
  const snapshot = snapshotCatalogUiState();
  try {
    // Replay against the complete checked values without making baseline
    // values explicit user intent.
    if (evaluation.context?.values) restoreMap(menuValues, evaluation.context.values);
    markCatalogStateChanged();
    for (const action of evaluation.actions || []) {
      // A confirmed compatibility plan is direct user intent. Recording only
      // a recommendation would leave imported/explicit Y overrides intact and
      // resurrect the cancelled package when the final config is rebuilt.
      const intentSource = action.kind === 'compatibility' ? 'user' : 'recommended';
      if (action.kind === 'scalar') {
        applyMenuValue(menuOptionBySymbol.get(action.symbol), action.value, false, 'recommended');
        continue;
      }
      if (action.kind === 'reconcile') {
        reconcileImportedConditionalDefaults({ dependencySeeds: action.dependencySeeds });
        continue;
      }
      for (const step of action.steps || []) {
        if ((menuValues.get(step.symbol) ?? 'n') === step.value) continue;
        applyCatalogIntent(menuOptionBySymbol.get(step.symbol) || { symbol: step.symbol },
          step.value, false, intentSource);
      }
      const current = menuValues.get(action.symbol) ?? action.value ?? 'n';
      applyCatalogIntent(menuOptionBySymbol.get(action.symbol) || { symbol: action.symbol },
        action.value ?? current, false, intentSource);
    }
    const remaining = configurationBlockingViolations();
    const beforeKeys = new Set((evaluation.initialViolations || []).map(configurationViolationKey));
    if (remaining.some((row) => !beforeKeys.has(configurationViolationKey(row)))) {
      throw new Error(t('runtime.configurationPreflightNoProgress'));
    }
    renderCatalogUiAfterIntent();
    return remaining;
  } catch (error) {
    restoreCatalogUiState(snapshot);
    throw error;
  }
}

function openBuildWarningModal(evaluation) {
  return new Promise((resolve) => {
    let rows = buildWarningRows(evaluation);
    const originalValues = new Map(evaluation.context?.values || menuValues);
    const custom = new Map(rows.map((row) => [row.symbol,
      originalValues.get(row.symbol) ?? (scalarKconfigOption(row.option) ? null : 'n')]));
    const manualSymbols = new Set();
    let appliedChanges = [];
    let applied = false;
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      modalCancelHandler = null;
      closeModal();
      resolve(action);
    };
    const cancel = () => finish('cancel');
    const renderShell = (title) => {
      if ($('modal').hidden) openModal(title);
      else $('modalTitle').textContent = title;
      const modal = $('modal').querySelector('.modal');
      modal.classList.remove('modal-wide', 'modal-import-source', 'recommended-config',
        'profile-package-config', 'generation-error', 'catalog-conflict', 'compatibility-warning',
        'rootfs-guidance');
      modal.classList.add('catalog-conflict', 'compatibility-warning');
      const body = $('modalBody');
      body.textContent = '';
      return body;
    };
    let renderChoice;
    const reviewApplied = () => {
      evaluation = buildWarningEvaluation(evaluation.loaded);
      rows = [...new Map([...rows, ...buildWarningRows(evaluation)].map(row => [row.symbol, row])).values()];
      const values = evaluation.context?.values || menuValues;
      appliedChanges = configurationReviewChanges(originalValues, values, manualSymbols);
      custom.clear();
      for (const row of rows) custom.set(row.symbol, values.get(row.symbol) ??
        (scalarKconfigOption(row.option) ? null : 'n'));
      applied = true; renderChoice();
    };
    const renderForceConfirmation = () => {
      modalCancelHandler = renderChoice;
      const body = renderShell(t('runtime.configurationPreflightForceTitle'));
      const copy = document.createElement('p');
      copy.className = 'catalog-conflict-warning';
      copy.textContent = t('runtime.configurationPreflightForceCopy');
      const actions = document.createElement('div');
      actions.className = 'modal-actions compatibility-actions';
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'btn';
      back.textContent = t('runtime.9e930674eccd'); back.onclick = renderChoice;
      const confirm = document.createElement('button');
      confirm.type = 'button'; confirm.className = 'btn compatibility-force-confirm';
      const remember = UI_COMPONENTS.createUiCheckboxControl({ className: 'compatibility-remember',
        label: t('runtime.d31806bd1f95'), checked: false,
        tooltipTitle: t('runtime.d31806bd1f95'), tooltipBody: t('runtime.e8bd8b88ed27') });
      remember.root.hidden = !!evaluation.initialViolations.length;
      confirm.textContent = t('runtime.383ef2ad4c67');
      confirm.onclick = () => finish(remember.input.checked ? 'forced-remember' : 'forced');
      actions.append(remember.root, back, confirm);
      body.appendChild(copy);
      UI_COMPONENTS.mountUiModalActions(body, actions);
    };
    renderChoice = () => {
      modalCancelHandler = cancel;
      const body = renderShell(t('compatibility.warningTitle'));
      const copy = document.createElement('p');
      copy.className = 'catalog-conflict-copy';
      copy.textContent = applied && !buildWarningCount(evaluation) ? t('configuration.reviewReady') :
        t('runtime.configurationPreflightSummary', {
          value1: buildWarningCount(evaluation),
        });
      body.appendChild(copy);
      const violationList = document.createElement('div');
      violationList.className = 'catalog-conflict-list';
      for (const violation of (evaluation.initialViolations || []).slice(0, 64)) {
        const line = document.createElement('div');
        line.className = 'catalog-conflict-row';
        const name = document.createElement('code');
        name.textContent = displayCompatibilityIdentity(violation);
        const detail = document.createElement('span');
        detail.textContent = displayCompatibilityDetail(violation);
        line.append(name, detail);
        violationList.appendChild(line);
      }
      body.appendChild(violationList);
      for (const warning of evaluation.compatibility.warnings) {
        const card = document.createElement('section'); card.className = 'compatibility-summary';
        const title = document.createElement('strong'); title.className = 'compatibility-summary-title';
        title.textContent = displayText(warning.rule.id + ' · ' + warning.records.map(row => row.package).join(' + '));
        const copy = document.createElement('p'); copy.className = 'compatibility-summary-copy';
        copy.textContent = t(warning.rule.policy === 'preventive' ? 'compatibility.preventive.copy' :
          warning.rule.issue === 'file-ownership' ? 'runtime.4152b783f1ae' : 'runtime.9da7c55fb368');
        card.append(title, copy);
        const missing = warning.rule.failure?.observed?.missingDependencies || [];
        if (missing.length) {
          const detail = document.createElement('p');
          detail.textContent = t('dependency.missing', { dependency: missing.map(displayPackageName).join(', ') });
          card.appendChild(detail);
        }
        for (const path of warning.rule.paths || []) {
          const code = document.createElement('code'); code.textContent = displayText(path); card.appendChild(code);
        }
        const evidence = document.createElement('details'); evidence.className = 'compatibility-evidence';
        const summary = document.createElement('summary');
        summary.textContent = displayText([warning.rule.failure?.phase, warning.rule.failure?.code].filter(Boolean).join(' · ') || warning.rule.id);
        const refs = document.createElement('p');
        refs.textContent = displayText((warning.rule.refs || (warning.rule.evidence || []).flatMap(row => row.refs || [])).join(' · '));
        evidence.append(summary, refs); card.appendChild(evidence); body.appendChild(card);
      }
      appendConfigurationReview(body, appliedChanges, true);
      const draftValues = new Map(evaluation.context?.values || menuValues);
      for (const [symbol, value] of custom) {
        if (value === null) draftValues.delete(symbol); else draftValues.set(symbol, value);
      }
      if (rows.length) {
        const customList = document.createElement('div');
        customList.className = 'catalog-conflict-list';
        for (const row of rows) {
          const line = document.createElement('div');
          line.className = 'catalog-conflict-row';
          const name = document.createElement('code');
          name.textContent = displayText(row.record.package || row.symbol);
          const constraints = CATALOG_ENGINE.kconfigStateConstraints(CATALOG_MODEL, row.record,
            draftValues, evaluation.context?.validationOptions);
          if (scalarKconfigOption(row.option)) {
            const stateBox = document.createElement('span'); stateBox.className = 'catalog-conflict-state';
            const input = document.createElement('input');
            input.type = 'text'; input.inputMode = row.record.type === 'int' ? 'numeric' : 'text';
            input.value = custom.get(row.symbol) ?? '';
            input.readOnly = constraints.readOnly;
            input.setAttribute('aria-label', displayText(row.symbol));
            input.onchange = () => { custom.set(row.symbol, input.value); renderChoice(); };
            stateBox.appendChild(input);
            if (constraints.canUnset) {
              const unset = document.createElement('button');
              unset.type = 'button'; unset.className = 'btn';
              unset.textContent = t('configuration.removeInactive');
              unset.onclick = () => { custom.set(row.symbol, null); renderChoice(); };
              stateBox.appendChild(unset);
            }
            line.append(name, stateBox); customList.appendChild(line);
            continue;
          }
          const stateBox = UI_COMPONENTS.createUiKconfigStateControl({
            type: row.record.type, value: custom.get(row.symbol), constraints,
            bindTooltip: (button, stateValue, limits) => bindKconfigConstraintTooltip(button, row.option, stateValue, limits),
            onUnavailable: showDatasetTooltip,
            onChange: (stateValue) => { custom.set(row.symbol, stateValue); renderChoice(); },
          });
          line.append(name, stateBox); customList.appendChild(line);
        }
        body.appendChild(customList);
      }
      const note = document.createElement('p');
      note.className = 'compatibility-recommendation-detail';
      note.textContent = applied && !buildWarningCount(evaluation) ? t('configuration.reviewReady') : evaluation.actions?.length
        ? t('runtime.configurationPreflightRecommendation', { value1: evaluation.actions.length })
        : t('runtime.configurationPreflightUnavailable');
      const recommendation = document.createElement('section');
      recommendation.className = `compatibility-recommendation${applied ? ' is-applied' : ''}${evaluation.actions.length ? '' : ' is-unavailable'}`;
      const heading = document.createElement('strong'); heading.className = 'compatibility-recommendation-title';
      heading.textContent = t(applied ? 'runtime.6b0a0ee100a5' : 'runtime.5c2c197f7d61');
      recommendation.append(heading, note);
      if (evaluation.actions.length) {
        const steps = document.createElement('p'); steps.className = 'compatibility-recommendation-action';
        steps.textContent = evaluation.actions.flatMap(action => [...(action.steps || []), action])
          .filter(action => action.symbol && action.value !== undefined)
          .map(action => `${displayConfigSymbol(action.symbol, { kind: 'config' })}=${String(action.value).toUpperCase()}`).join(' → ');
        recommendation.appendChild(steps);
      }
      body.appendChild(recommendation);
      const recommendationSymbols = new Set((evaluation.actions || []).flatMap((action) =>
        [action.symbol, ...(action.steps || []).map((step) => step.symbol)].filter(Boolean)));
      appendConfigurationReview(body, configurationReviewChanges(evaluation.context?.values || menuValues,
        evaluation.finalValues || evaluation.values || menuValues, recommendationSymbols));
      if (evaluation.compatibility.warnings.some(warning => warning.rule.failure?.code === 'missing-package-dependencies') &&
          (evaluation.actions || []).some((action) => action.value === 'n')) {
        const risk = document.createElement('p'); risk.className = 'catalog-conflict-warning';
        risk.textContent = t('configuration.reviewRiskAvoidance'); body.appendChild(risk);
      }
      appendConfigurationReview(body, configurationReviewChanges(evaluation.context?.values || menuValues,
        draftValues, new Set(custom.keys())));
      for (const action of evaluation.actions || []) if (action.kind === 'scalar') {
        const detail = document.createElement('p');
        detail.textContent = action.value === null
          ? t('configuration.removeInactiveDetail', { symbol: displayText(action.symbol) })
          : t('configuration.restoreTypedDefault', { symbol: displayText(action.symbol), value: action.value });
        body.appendChild(detail);
      }
      const warning = document.createElement('p');
      warning.className = 'catalog-conflict-warning'; body.appendChild(warning);
      const actions = document.createElement('div');
      actions.className = 'modal-actions compatibility-actions';
      const force = document.createElement('button');
      force.type = 'button'; force.className = 'btn compatibility-force';
      force.textContent = t('runtime.3ea8d64eb087'); force.onclick = renderForceConfirmation;
      force.disabled = !buildWarningCount(evaluation);
      const customButton = document.createElement('button');
      customButton.type = 'button'; customButton.className = 'btn compatibility-custom';
      customButton.textContent = t('configuration.applyCustomValues'); customButton.disabled = !rows.length;
      customButton.onclick = () => withUiComputation(t('busy.processing'), () => {
        const snapshot = snapshotCatalogUiState();
        try {
          const before = new Map(evaluation.context?.values || menuValues);
          if (evaluation.context?.values) restoreMap(menuValues, evaluation.context.values);
          markCatalogStateChanged();
          for (const row of rows.filter((row) => scalarKconfigOption(row.option))) {
            if (custom.get(row.symbol) !== (before.get(row.symbol) ?? null)) {
              manualSymbols.add(row.symbol);
              applyMenuValue(row.option, custom.get(row.symbol), false, 'user');
            }
          }
          const editedRows = rows.filter((row) => !scalarKconfigOption(row.option) &&
            custom.get(row.symbol) !== (before.get(row.symbol) ?? 'n'));
          for (const row of editedRows) manualSymbols.add(row.symbol);
          if (editedRows.length) {
            const assignments = new Map(editedRows.map(row => [row.symbol, custom.get(row.symbol)]));
            const first = editedRows[0];
            applyCatalogIntent(first.option, assignments.get(first.symbol), false, 'user', assignments);
          }
          if (buildWarningCount(buildWarningEvaluation(evaluation.loaded))) {
            throw new Error(t('runtime.configurationPreflightCustomInvalid'));
          }
          renderCatalogUiAfterIntent(); reviewApplied();
        } catch (error) {
          restoreCatalogUiState(snapshot);
          warning.textContent = displayText(String(error?.message || error).split(';')[0]);
        }
      });
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button'; cancelButton.className = 'btn compatibility-close';
      cancelButton.textContent = t('runtime.9e930674eccd'); cancelButton.onclick = cancel;
      const recommended = document.createElement('button');
      recommended.type = 'button'; recommended.className = 'btn btn-primary compatibility-recommended';
      recommended.textContent = t('runtime.configurationPreflightApplyAll');
      recommended.disabled = !evaluation.actions?.length;
      recommended.onclick = async () => {
        try {
          await withUiComputation(t('busy.processing'), () => {
            applyBuildWarningRecommendation(evaluation);
            for (const symbol of recommendationSymbols) manualSymbols.add(symbol);
            reviewApplied();
          });
        } catch (error) {
          warning.textContent = displayText(String(error?.message || error).split(';')[0]);
        }
      };
      const spacer = document.createElement('span');
      spacer.className = 'compatibility-actions-spacer'; spacer.setAttribute('aria-hidden', 'true');
      actions.append(force, customButton, spacer, cancelButton, recommended);
      if (applied && !buildWarningCount(evaluation)) {
        recommended.hidden = true;
        actions.appendChild(UI_COMPONENTS.createUiButton({ className: 'btn btn-primary configuration-continue',
          text: t('configuration.reviewContinue'), onClick: () => finish('applied') }));
      }
      UI_COMPONENTS.mountUiModalActions(body, actions);
    };
    renderChoice();
  });
}

function compatibilityIdentityError(detail) {
  const error = new Error(`Catalog compatibility identity is invalid: ${detail}`);
  error.name = 'CompatibilityIdentityError';
  return error;
}

function resolveCompatibilityIdentity(source, branch, loadedSource) {
  const sourceId = String(source?.id || '').trim();
  const branchName = String(branch?.branch || '').trim();
  const sourceCommit = String(branch?.commit || '').trim().toLowerCase();
  const loadedSourceId = String(loadedSource?.id || '').trim();
  const loadedBranchName = String(loadedSource?.branch || '').trim();
  const loadedCommit = String(loadedSource?.commit || '').trim().toLowerCase();
  if (!sourceId || !branchName || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw compatibilityIdentityError('the active Catalog index source, branch, or commit is missing');
  }
  if (sourceId !== loadedSourceId || branchName !== loadedBranchName ||
      !/^[0-9a-f]{40}$/.test(loadedCommit) || sourceCommit !== loadedCommit) {
    throw compatibilityIdentityError('the active Catalog index does not match the loaded Catalog asset');
  }
  return { sourceId, branchName, sourceCommit };
}

function compatibilityContext(inputValues = configurationPreflightValues()) {
  const catalog = catalogValidationContext(inputValues, 'interactive');
  const source = selectedCatalogSource();
  const branch = selectedCatalogBranch(source);
  const identity = resolveCompatibilityIdentity(source, branch, MENU_CATALOG?.source);
  const target = state.device?.target || {};
  const targetSystem = String(target.system || '');
  const targetSubtarget = String(target.subtarget || '');
  const targetProfile = String(target.profileSymbol || target.profile || '');
  return {
    sourceId: identity.sourceId,
    branchName: identity.branchName,
    sourceCommit: identity.sourceCommit,
    inputsHash: String(MENU_CATALOG?.source?.inputsHash || ''),
    targetSystem,
    targetSubtarget,
    targetProfile,
    targetKey: [targetSystem, targetSubtarget, targetProfile].join('/'),
    values: catalog.values,
    validationOptions: catalog.validationOptions,
  };
}

function evaluateLoadedCompatibility(loaded, inputValues = configurationPreflightValues()) {
  const context = compatibilityContext(inputValues);
  const evaluation = CATALOG_ENGINE.evaluateCompatibilityRules(
    CATALOG_MODEL, loaded.compatibility, context.values, context,
  );
  return { loaded, context, ...evaluation };
}

async function loadCompatibilityEvaluation(forceRefresh = false) {
  if (!CATALOG_LOADER || !CATALOG_MODEL || !MENU_CATALOG) {
    throw new Error(t('runtime.da4e36d4cbd1'));
  }
  const loaded = await CATALOG_LOADER.fetchCompatibility({ forceRefresh });
  return evaluateLoadedCompatibility(loaded);
}

async function runCatalogTaskQueue(names, tasks, concurrency, catalogKey = '', phase = 'idle') {
  const queue = names.map((name) => ({ name, task: tasks[name] })).filter((item) => item.task);
  const workerCount = Math.max(1, Math.min(queue.length || 1, Number(concurrency) || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      if (catalogKey && menuCatalogKey !== catalogKey) return;
      const item = queue.shift();
      try { await item.task(); }
      catch (error) { console.warn(`[Catalog ${phase} task: ${item.name}]`, error); }
    }
  }));
}

function scheduleCatalogIdlePrefetch() {
  clearTimeout(compatibilityPrefetchTimer);
  const catalogKey = menuCatalogKey;
  const tasks = {
    applications: ensureCatalogApplications,
    hidden: ensureCatalogHiddenLoaded,
    help: ensureCatalogHelpLoaded,
    compatibility: () => CATALOG_LOADER?.fetchCompatibility(),
  };
  const names = PROJECT?.catalogLoadPolicy?.idle ||
    ['applications', 'hidden', 'help', 'compatibility'];
  const delay = Math.max(0, Math.min(60000, Number(PROJECT?.catalogLoadPolicy?.idleDelayMs) || 15000));
  compatibilityPrefetchTimer = setTimeout(() => {
    const run = () => runCatalogTaskQueue(names, tasks,
      PROJECT?.catalogLoadPolicy?.idleConcurrency || 1, catalogKey, 'idle');
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { run(); }, { timeout: 5000 });
    else setTimeout(() => { run(); }, 0);
  }, delay);
}

function compatibilitySignature(evaluation) {
  return CATALOG_ENGINE.compatibilityAcknowledgementKey({
    sha256: evaluation.loaded.hash,
    dataRef: evaluation.loaded.dataRef || MENU_CATALOG_DATA_REF,
    sourceId: evaluation.context.sourceId,
    branchName: evaluation.context.branchName,
    sourceCommit: evaluation.context.sourceCommit,
    targetKey: evaluation.context.targetKey,
    revision: catalogStateRevision,
    ruleIds: evaluation.warnings.map((warning) => warning.rule.id),
  });
}

function forcedCompatibilityAudit(evaluation, forced) {
  const ruleIds = [...forced].sort();
  if (!ruleIds.length) return null;
  return {
    sha256: evaluation.loaded.hash,
    source: evaluation.context.sourceId,
    branch: evaluation.context.branchName,
    sourceCommit: evaluation.context.sourceCommit,
    target: evaluation.context.targetKey,
    forced: ruleIds,
  };
}

function compatibilityTargetsResolved(targets = []) {
  return targets.every((target) =>
    (menuValues.get(target.symbol) ?? 'n') === (target.value || 'n'));
}

// Native consistency and Catalog evidence share one explicit review surface.
// Installation faults are owned by compatibility.json, not a parallel package
// blacklist or automatic missing-provider cancellation path.
function buildWarningCount(evaluation) {
  return evaluation.initialViolations.length + evaluation.compatibility.warnings.length;
}

function buildWarningEvaluation(loaded) {
  const native = configurationPreflightEvaluation();
  const compatibility = evaluateLoadedCompatibility(loaded);
  let values = new Map(native.finalValues || native.values);
  const actions = [...native.actions];
  const dependencySymbols = new Set();
  const retainedTargets = [];
  const unresolved = [...native.unresolved];
  for (const warning of compatibility.warnings) {
    const current = evaluateLoadedCompatibility(loaded, values).warnings.find(row => row.rule.id === warning.rule.id);
    if (!current) continue;
    const plans = CATALOG_ENGINE.deriveCompatibilityPlans(CATALOG_MODEL, current.values, current, {
      dependencySymbols: catalogDependencySymbols, protectedSymbols: catalogProtectedSymbols(),
      preferredValues: catalogPreferredValues(), derivedSymbols: catalogConditionalDefaultSymbols,
      explicitSymbols: new Set(catalogUserOverrides.keys()),
      validationOptions: { ...compatibility.context.validationOptions, scope: 'menuconfig' },
    });
    if (!plans.recommended) { unresolved.push({ ruleId: warning.rule.id, reasons: plans.reason }); continue; }
    const plan = plans.recommended;
    for (const symbol of plan.dependencySymbols || []) dependencySymbols.add(symbol);
    for (const target of plan.retainedTargets || []) retainedTargets.push(target);
    const steps = plan.steps?.length ? plan.steps : [{ symbol: plan.symbol, value: 'n' }];
    const included = new Set(steps.map(step => step.symbol));
    for (const step of [...steps, ...(plan.requiredTargets || []).filter(target => !included.has(target.symbol))]) {
      actions.push({ symbol: step.symbol, value: step.value || 'n', steps: [], kind: 'compatibility' });
    }
    values = new Map(plan.values);
  }
  return { ...native, loaded, compatibility, actions, finalValues: values, unresolved,
    dependencySymbols, retainedTargets };
}

function buildWarningRows(evaluation) {
  const rows = configurationPreflightRows(evaluation);
  const symbols = new Set(rows.map(row => row.symbol));
  for (const warning of evaluation.compatibility.warnings) for (const record of warning.records) {
    if (symbols.has(record.configSymbol)) continue;
    symbols.add(record.configSymbol);
    rows.push({ symbol: record.configSymbol, record,
      option: menuOptionBySymbol.get(record.configSymbol) || { symbol: record.configSymbol, type: record.type } });
  }
  return rows;
}

function applyBuildWarningRecommendation(evaluation) {
  const snapshot = snapshotCatalogUiState();
  try {
    if (evaluation.context?.values) restoreMap(menuValues, evaluation.context.values);
    for (const symbol of evaluation.dependencySymbols) catalogDependencySymbols.add(symbol);
    for (const target of evaluation.retainedTargets) {
      applyCatalogIntent(menuOptionBySymbol.get(target.symbol) || { symbol: target.symbol },
        target.value, false, 'user');
    }
    applyConfigurationRecommendation(evaluation);
    const next = buildWarningEvaluation(evaluation.loaded);
    const beforeKeys = new Set(evaluation.initialViolations.map(configurationViolationKey));
    if (buildWarningCount(next) >= buildWarningCount(evaluation) ||
        next.initialViolations.some(row => !beforeKeys.has(configurationViolationKey(row))) ||
        !compatibilityTargetsResolved(evaluation.retainedTargets)) {
      throw new Error(t('runtime.configurationPreflightNoProgress'));
    }
    renderCatalogUiAfterIntent();
  } catch (error) { restoreCatalogUiState(snapshot); throw error; }
}

async function ensureBuildPreflight() {
  const loaded = (await loadCompatibilityEvaluation()).loaded;
  while (true) {
    const evaluation = await withUiComputation(t('busy.processing'), () => buildWarningEvaluation(loaded));
    if (!buildWarningCount(evaluation)) return { configuration: null, compatibility: null,
      config: await generateResolvedConfigText() };
    const signature = compatibilitySignature(evaluation.compatibility);
    const acknowledged = UI_SESSION.compatibility.getAcknowledgement();
    if (!evaluation.initialViolations.length && acknowledged?.signature === signature) {
      return { configuration: null, compatibility: acknowledged.audit, config: await generateResolvedConfigText() };
    }
    const action = await withUiOperationInteraction(() => openBuildWarningModal(evaluation));
    if (action === 'applied') continue;
    if (action === 'forced' || action === 'forced-remember') {
      // Keep the established wire audit fields readable for old requests.
      const configuration = forcedConfigurationAudit(evaluation);
      const compatibility = forcedCompatibilityAudit(evaluation.compatibility,
        new Set(evaluation.compatibility.warnings.map(warning => warning.rule.id)));
      if (action === 'forced-remember' && compatibility && !configuration) {
        UI_SESSION.compatibility.setAcknowledgement({ signature, audit: compatibility });
      } else UI_SESSION.compatibility.clearAcknowledgement();
      return { configuration, compatibility, config: await generateResolvedConfigText() };
    }
    const error = new Error('Build warning review cancelled');
    error.name = 'CompatibilityCancelledError'; throw error;
  }
}
