// whoa, no typescript and no compilation!

const LibManager = {
  libs: {},

  coreLibPath: `https://unpkg.com/typescript@${window.CONFIG.TSVersion}/lib/`,

  getReferencePaths(input) {
    const rx = /<reference path="([^"]+)"\s\/>/;
    return (input.match(new RegExp(rx.source, "g")) || []).map(s => {
      const match = s.match(rx);
      if (match && match.length >= 2) {
        return match[1];
      } else {
        throw new Error(`Error parsing: "${s}".`);
      }
    });
  },

  basename(url) {
    const parts = url.split("/");
    if (parts.length === 0) {
      throw new Error(`Bad url: "${url}"`);
    }
    return parts[parts.length - 1];
  },

  addLib: async function(path, ...args) {
    if (path.indexOf("http") === 0) {
      return this._addRemoteLib(path, ...args);
    }
    return this._addCoreLib(path, ...args);
  },

  _addCoreLib: async function(fileName, ...args) {
    return this._addRemoteLib(`${this.coreLibPath}${fileName}`, ...args);
  },

  _addRemoteLib: async function(url, stripNoDefaultLib = true, followReferences = true) {
    const fileName = this.basename(url);

    if (this.libs[fileName]) {
      return;
    }

    UI.toggleSpinner(true);
    const res = await fetch(url);
    if (res.status === 404) {
      console.log(`Check https://unpkg.com/typescript@${window.CONFIG.TSVersion}/lib/`);
    }
    const rawText = await res.text();

    UI.toggleSpinner(false);

    const text = stripNoDefaultLib ? rawText.replace('/// <reference no-default-lib="true"/>', "") : rawText;

    if (followReferences) {
      const paths = this.getReferencePaths(text);
      if (paths.length > 0) {
        console.log(`${fileName} depends on ${paths.join(", ")}`);
        for (const path of paths) {
          await this._addCoreLib(path, stripNoDefaultLib, followReferences);
        }
      }
    }

    const lib = monaco.languages.typescript.typescriptDefaults.addExtraLib(text, fileName);

    console.groupCollapsed(`Added '${fileName}'`);
    console.log(text);
    console.groupEnd();

    this.libs[fileName] = lib;

    return lib;
  },

  acquireModuleMetadata: {},

  /**
   * @param {string} sourceCode 
   */
  detectNewImportsToAcquireTypeFor: async function(sourceCode) {

   /**
   * @param {string} sourceCode 
   */
    const getTypeDependenciesForSourceCode = (sourceCode) => {
      // TODO: debounce
      //
      // TODO: This needs to be replaced by the AST - it still works in comments 
      // blocked by https://github.com/microsoft/monaco-typescript/pull/38
      //
      // TODO:Add hardcoded module lookups for node built-ins
      //
      // TODO: Support pulling out the root component of a module first to grab that, so it can grab sub-definitions 
      //
      // https://regex101.com/r/Jxa3KX/4
      const requirePattern = /(const|let|var)(.|\n)*? require\(('|")(.*)('|")\);?$/
      //  https://regex101.com/r/hdEpzO/3
      const es6Pattern = /import((?!from)(?!require)(.|\n))*?(from|require\()\s?('|")(.*)('|")\)?;?$/gm
  
      const foundModules = new Set()
      
      while ((match = es6Pattern.exec(sourceCode)) !== null) {
        if (match[5]) foundModules.add(match[5])
      }
  
      while ((match = requirePattern.exec(sourceCode)) !== null) {
        if (match[5]) foundModules.add(match[5])
      }
      console.log(this.acquireModuleMetadata)
      
      const filteredModulesToLookAt =  Array.from(foundModules).filter(
        // local import
        m => !m.startsWith(".") &&
        // already tried and failed
        this.acquireModuleMetadata[m] === undefined
        )
      console.log(filteredModulesToLookAt)
      
      
      const moduleJSONURL = (name) => `http://ofcncog2cu-dsn.algolia.net/1/indexes/npm-search/${encodeURIComponent(name)}?x-algolia-agent=Algolia%20for%20vanilla%20JavaScript%20(lite)%203.27.1&x-algolia-application-id=OFCNCOG2CU&x-algolia-api-key=f54e21fa3a2a0160595bb058179bfb1e`
      const unpkgURL = (name, path) => `https://www.unpkg.com/${encodeURIComponent(name)}/${encodeURIComponent(path)}`
      const packageJSONURL = (name) => unpkgURL(name, "package.json")
  
      filteredModulesToLookAt.forEach(async mod => {
        // So it doesn't run twice
        this.acquireModuleMetadata[mod] = null
  
        const url = moduleJSONURL(mod)
        
        const response = await fetch(url)
        const error = (msg, response) => { console.error(`${msg} - will not try again in this session`, response.status, response.statusText, response) }
        if (!response.ok) { return error(`Could not get Algolia JSON for the module '${mod}'`,  response) }
        
        const responseJSON = await response.json()
        if (!responseJSON) { return error(`Could not get Algolia JSON for the module '${mod}'`, response) }
  
        if (!responseJSON.types) { return console.log(`There were no types for '${mod}' - will not try again in this session`)  }
        if (!responseJSON.types.ts) { return console.log(`There were no types for '${mod}' - will not try again in this session`)  }
  
        this.acquireModuleMetadata[mod] = responseJSON
        // console.log(responseJSON)
  
        /**
         * Takes an initial module and the path for the root of the typings and grab it and start grabbing its 
         * dependencies then add those the to runtime.
         *
         * @param {string} mod The mobule name
         * @param {string} path  The path to the root def typ[e]
         */
        const addModuleToRuntime =  async (mod, path) => {
          const folderToBeRelativeFrom = path.substr(0, path.lastIndexOf("/"))
          const dtsFileURL = unpkgURL(mod, path)
  
          const dtsResponse = await fetch(dtsFileURL)
          if (!dtsResponse.ok) { return error(`Could not get root d.ts file for the module '${mod}' at ${path}`, dtsResponse) }
  
          let dtsResponseText = await dtsResponse.text()
          if (!dtsResponseText) { return error(`Could not get root d.ts file for the module '${mod}' at ${path}`, dtsResponse) }
  
          // For now lets try only one level deep for the references. This means we don't have to deal with potential 
          // infinite loops - open to PRs adding that
          if (dtsResponseText.indexOf("reference path") > 0) {  
            // https://regex101.com/r/DaOegw/1
            const referencePathExtractionPattern = /<reference path="(.*)" \/>/gm
            while ((match = referencePathExtractionPattern.exec(dtsResponseText)) !== null) {
              const relativePath = match[1]
              if (relativePath) {
                
                let newPath = null
                // Starts with ./
                if (relativePath.indexOf("./") === 0) {
                  newPath = folderToBeRelativeFrom + relativePath.substr(2)
                } else {
                  newPath = folderToBeRelativeFrom + relativePath
                }
    
                if (newPath) {
                  const dtsRefURL = unpkgURL(mod, newPath)
                  const dtsReferenceResponse = await fetch(dtsRefURL)
                  if (!dtsReferenceResponse.ok) { return error(`Could not get ${newPath} for a reference link in the module '${mod}' from ${path}`, dtsReferenceResponse) }
          
                  let dtsReferenceResponseText = await dtsReferenceResponse.text()
                  if (!dtsReferenceResponseText) { return error(`Could not get ${newPath} for a reference link for the module '${mod}' from ${path}`, dtsReferenceResponse) }
  
                  const originalReferencePathReference = `<reference path="${relativePath}" />`
                  const replacement = `${originalReferencePathReference}\n// auto imported\n${dtsReferenceResponseText}`

                  dtsResponseText = dtsResponseText.replace(originalReferencePathReference, replacement)
                }
              }
            }
          }

          // Now look and grab dependent modules where you need the 
          // 
          await getTypeDependenciesForSourceCode(dtsResponseText)


          const typelessModule = mod.split("@types/").slice(-1)
        const wrapped = `
  declare module "${typelessModule}" {
    ${dtsResponseText}
  }
  `
          console.log({name: mod, content: wrapped })
          console.log( wrapped )
          monaco.languages.typescript.typescriptDefaults.addExtraLib(wrapped, `node_modules/${mod}/${path}`);
        }
        
        if (responseJSON.types.ts === "included") {
          const modPackageURL = packageJSONURL(mod)
  
          const response = await fetch(modPackageURL)
          if (!response.ok) { return error(`Could not get Package JSON for the module '${mod}'`, response) }
  
          const responseJSON = await response.json()
          if (!responseJSON) { return error(`Could not get Package JSON for the module '${mod}'`, response) }
  
          // Get the path of the root d.ts file
  
          // non-inferred route
          let rootTypePath = responseJSON.typing
          
          // package main is custom 
          if (!rootTypePath && typeof responseJSON.main === 'string' && responseJSON.main.indexOf('.js') > 0) {
            rootTypePath = responseJSON.main.replace(/js$/, 'd.ts');
          }
  
          // Final fallback, to have got here it must have passed in algolia
          if (!rootTypePath) {
            rootTypePath = "index.d.ts"
          }
  
  
          await addModuleToRuntime(mod, rootTypePath)
        } else if(responseJSON.types.ts === "definitely-typed") {
          await addModuleToRuntime(responseJSON.types.definitelyTyped, "index.d.ts")
        }
      })
    }

    // Start diving into the root 
    getTypeDependenciesForSourceCode(sourceCode)
  }
};

async function main() {
  const defaultCompilerOptions = {
    noImplicitAny: true,
    strictNullChecks: true,
    strictFunctionTypes: true,
    strictPropertyInitialization: true,
    noImplicitThis: true,
    noImplicitReturns: true,

    alwaysStrict: true,
    allowUnreachableCode: false,
    allowUnusedLabels: false,

    downlevelIteration: false,
    noEmitHelpers: false,
    noLib: false,
    noStrictGenericChecks: false,
    noUnusedLocals: false,
    noUnusedParameters: false,

    esModuleInterop: false,
    preserveConstEnums: false,
    removeComments: false,
    skipLibCheck: false,

    experimentalDecorators: false,
    emitDecoratorMetadata: false,

    target: monaco.languages.typescript.ScriptTarget.ES2017,
    jsx: monaco.languages.typescript.JsxEmit.None,
  };

  const urlDefaults = Object.entries(defaultCompilerOptions).reduce(
    (acc, [key, value]) => {
      if (params.has(key)) {
        const urlValue = params.get(key);

        if (urlValue === "true") {
          acc[key] = true;
        } else if (urlValue === "false") {
          acc[key] = false;
        } else if (!isNaN(parseInt(urlValue, 10))) {
          acc[key] = parseInt(params.get(key), 10);
        }
      }

      return acc;
    },
    {},
  );

  console.log("Url defaults", urlDefaults);

  const compilerOptions = Object.assign(
    {},
    defaultCompilerOptions,
    urlDefaults,
  );

  const sharedEditorOptions = {
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
  };

  const State = {
    inputModel: null,
    outputModel: null,
  };

  let inputEditor, outputEditor;

  function createSelect(obj, globalPath, title, compilerOption) {
    return `<label class="select">
    <span class="select-label">${title}</span>
  <select onchange="console.log(event.target.value); UI.updateCompileOptions('${compilerOption}', ${globalPath}[event.target.value]);">
  ${Object.keys(obj)
    .filter(key => isNaN(Number(key)))
    .map(key => {
      if (key === "Latest") {
        // hide Latest
        return "";
      }

      const isSelected = obj[key] === compilerOptions[compilerOption];

      return `<option ${
        isSelected ? "selected" : ""
      } value="${key}">${key}</option>`;
    })}
  </select>
  </label>`;
  }

  function createFile(compilerOptions) {
    return monaco.Uri.file(
      "input." +
      (compilerOptions.jsx === monaco.languages.typescript.JsxEmit.None
        ? "ts"
        : "tsx")
    )
  }

  window.UI = {
    tooltips: {},

    shouldUpdateHash: false,

    showFlashMessage(message) {
      const node = document.querySelector(".flash");
      const messageNode = node.querySelector(".flash__message");

      messageNode.textContent = message;

      node.classList.toggle("flash--hidden", false);
      setTimeout(() => {
        node.classList.toggle("flash--hidden", true);
      }, 1000);
    },

    fetchTooltips: async function() {
      try {
        this.toggleSpinner(true);
        const res = await fetch(`${window.CONFIG.baseUrl}schema/tsconfig.json`);
        const json = await res.json();
        this.toggleSpinner(false);

        for (const [propertyName, property] of Object.entries(
          json.definitions.compilerOptionsDefinition.properties.compilerOptions
            .properties,
        )) {
          this.tooltips[propertyName] = property.description;
        }
      } catch (e) {
        console.error(e);
        // not critical
      }
    },

    renderAvailableVersions() {
      const node = document.querySelector("#version-popup");
      const html = `
    <ul class="versions">
    ${Object.keys(window.CONFIG.availableTSVersions)
      .sort()
      .reverse()
      .map(version => {
        return `<li class="button" onclick="javascript:UI.selectVersion('${version}');">${version}</li>`;
      })
      .join("\n")}
    </ul>
    `;

      node.innerHTML = html;
    },

    renderVersion() {
      const node = document.querySelector("#version");
      const childNode = node.querySelector("#version-current");

      childNode.textContent = `${window.CONFIG.TSVersion}`;

      node.style.opacity = 1;
      node.classList.toggle("popup-on-hover", true);

      this.toggleSpinner(false);
    },

    toggleSpinner(shouldShow) {
      document
        .querySelector(".spinner")
        .classList.toggle("spinner--hidden", !shouldShow);
    },

    renderSettings() {
      const node = document.querySelector("#settings-popup");

      const html = `
      ${createSelect(
        monaco.languages.typescript.ScriptTarget,
        "monaco.languages.typescript.ScriptTarget",
        "Target",
        "target",
      )}
      <br />
      ${createSelect(
        monaco.languages.typescript.JsxEmit,
        "monaco.languages.typescript.JsxEmit",
        "JSX",
        "jsx",
      )}
    <ul style="margin-top: 1em;">
    ${Object.entries(compilerOptions)
      .filter(([_, value]) => typeof value === "boolean")
      .map(([key, value]) => {
        return `<li style="margin: 0; padding: 0;" title="${UI.tooltips[key] ||
          ""}"><label class="button" style="user-select: none; display: block;"><input class="pointer" onchange="javascript:UI.updateCompileOptions(event.target.name, event.target.checked);" name="${key}" type="checkbox" ${
          value ? "checked" : ""
        }></input>${key}</label></li>`;
      })
      .join("\n")}
    </ul>
    <p style="margin-left: 0.5em; margin-top: 1em;">
      <a href="https://www.typescriptlang.org/docs/handbook/compiler-options.html" target="_blank">
        Compiler options reference
      </a>
    </p>
    `;

      node.innerHTML = html;
    },

    console() {
      if (!window.ts) {
        return;
      }

      console.log(`Using TypeScript ${window.ts.version}`);

      console.log("Available globals:");
      console.log("\twindow.ts", window.ts);
      console.log("\twindow.client", window.client);
    },

    selectVersion(version) {
      if (version === window.CONFIG.getLatestVersion()) {
        location.href = `${window.CONFIG.baseUrl}${location.hash}`;
        return false;
      }

      location.href = `${window.CONFIG.baseUrl}?ts=${version}${location.hash}`;
      return false;
    },

    selectExample: async function(exampleName) {
      try {
        const res = await fetch(`./examples/${exampleName}.ts`,);
        const code = await res.text();
        UI.shouldUpdateHash = false;
        State.inputModel.setValue(code.trim());
        location.hash = `example/${exampleName}`;
        UI.shouldUpdateHash = true;
      } catch (e) {
        console.log(e);
      }
    },

    setCodeFromHash: async function() {
      if (location.hash.startsWith("#example")) {
        const exampleName = location.hash.replace("#example/", "").trim();
        UI.selectExample(exampleName);
      }
    },

    refreshOutput() {
      UI.shouldUpdateHash = false;
      State.inputModel.setValue(State.inputModel.getValue());
      UI.shouldUpdateHash = true;
    },

    updateURL() {
      const diff = Object.entries(defaultCompilerOptions).reduce(
        (acc, [key, value]) => {
          if (value !== compilerOptions[key]) {
            acc[key] = compilerOptions[key];
          }

          return acc;
        },
        {},
      );

      const hash = `code/${LZString.compressToEncodedURIComponent(
        State.inputModel.getValue(),
      )}`;
        
      const urlParams = Object.assign({}, diff);

      ["lib", "ts"].forEach(param => {
        if (params.has(param)) {
          urlParams[param] = params.get(param);
        }
      });

      if (Object.keys(urlParams).length > 0) {
        const queryString = Object.entries(urlParams)
          .map(([key, value]) => {
            return `${key}=${encodeURIComponent(value)}`;
          })
          .join("&");

        window.history.replaceState(
          {},
          "",
          `${window.CONFIG.baseUrl}?${queryString}#${hash}`,
        );
      } else {
        window.history.replaceState({}, "", `${window.CONFIG.baseUrl}#${hash}`);
      }
    },

    storeCurrentCodeInLocalStorage() {
      localStorage.setItem("playground-history", State.inputModel.getValue())
    },

    updateCompileOptions(name, value) {
      console.log(`${name} = ${value}`);

      Object.assign(compilerOptions, {
        [name]: value,
      });

      console.log("Updating compiler options to", compilerOptions);
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
        compilerOptions,
      );

      let inputCode = inputEditor.getValue();
      State.inputModel.dispose();
      State.inputModel = monaco.editor.createModel(
        inputCode,
        "typescript",
        createFile(compilerOptions)
      );
      inputEditor.setModel(State.inputModel);

      UI.refreshOutput();

      UI.renderSettings();

      UI.updateURL();
    },

    getInitialCode() {
      if (location.hash.startsWith("#src")) {
        const code = location.hash.replace("#src=", "").trim();
        return decodeURIComponent(code);
      }
      
      if (location.hash.startsWith("#code")) {
        const code = location.hash.replace("#code/", "").trim();
        return LZString.decompressFromEncodedURIComponent(code);
      }

      if (localStorage.getItem("playground-history")) {
        return localStorage.getItem("playground-history")
      }

      return `
const message: string = 'hello world';
console.log(message);
  `.trim();
    },
  };

  window.MonacoEnvironment = {
    getWorkerUrl: function(workerId, label) {
      return `worker.js?version=${window.CONFIG.getMonacoVersion()}`;
    },
  };

  for (const path of window.CONFIG.extraLibs) {
    await LibManager.addLib(path);
  }

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
    compilerOptions,
  );

  State.inputModel = monaco.editor.createModel(
    UI.getInitialCode(),
    "typescript",
    createFile(compilerOptions)
  );

  State.outputModel = monaco.editor.createModel(
    "",
    "javascript",
    monaco.Uri.file("output.js"),
  );

  inputEditor = monaco.editor.create(
    document.getElementById("input"),
    Object.assign({ model: State.inputModel }, sharedEditorOptions),
  );

  outputEditor = monaco.editor.create(
    document.getElementById("output"),
    Object.assign({ model: State.outputModel }, sharedEditorOptions),
  );

  function updateOutput() {
    monaco.languages.typescript.getTypeScriptWorker().then(worker => {
      worker(State.inputModel.uri).then((client, a) => {
        if (typeof window.client === "undefined") {
          UI.renderVersion();

          // expose global
          window.client = client;
          UI.console();
        }
        
        const userInput = State.inputModel
        const sourceCode =  userInput.getValue()
        LibManager.detectNewImportsToAcquireTypeFor(sourceCode)

        client.getEmitOutput(userInput.uri.toString()).then(result => {
          State.outputModel.setValue(result.outputFiles[0].text);
        });
      });
    });

    if (UI.shouldUpdateHash) {
      UI.updateURL();
    }

    UI.storeCurrentCodeInLocalStorage()
  }

  UI.setCodeFromHash();

  UI.renderSettings();
  UI.fetchTooltips().then(() => {
    UI.renderSettings();
  });

  updateOutput();
  inputEditor.onDidChangeModelContent(() => {
    updateOutput();
  });
  UI.shouldUpdateHash = true;

  UI.renderAvailableVersions();

  /* Run */
  document.getElementById("run").onclick = () => runJavaScript()
  function runJavaScript() {
    console.clear();
    // to hide the stack trace
    setTimeout(() => {
      eval(State.outputModel.getValue());
    }, 0);
  }

  inputEditor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
    runJavaScript,
  );

  outputEditor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
    runJavaScript,
  );

  inputEditor.addCommand(
    monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KEY_F,
    prettier,
  );

  // if the focus is outside the editor
  window.addEventListener(
    "keydown",
    event => {
      const S_KEY = 83;
      if (event.keyCode == S_KEY && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();

        window.clipboard.writeText(location.href.toString()).then(
          () => UI.showFlashMessage("URL is copied to the clipboard!"),
          e => {
            alert(e);
          },
        );
      }

      if (
        event.keyCode === 13 &&
        (event.metaKey || event.ctrlKey) &&
        event.target instanceof Node &&
        event.target === document.body
      ) {
        event.preventDefault();
        runJavaScript();
      }
    },
    false,
  );

  function prettier() {
    const PRETTIER_VERSION = "1.14.3";

    require([
      `https://unpkg.com/prettier@${PRETTIER_VERSION}/standalone.js`,
      `https://unpkg.com/prettier@${PRETTIER_VERSION}/parser-typescript.js`,
    ], function(prettier, { parsers }) {
      const cursorOffset = State.inputModel.getOffsetAt(
        inputEditor.getPosition(),
      );

      const formatResult = prettier.formatWithCursor(
        State.inputModel.getValue(),
        {
          parser: parsers.typescript.parse,
          cursorOffset,
        },
      );

      State.inputModel.setValue(formatResult.formatted);
      const newPosition = State.inputModel.getPositionAt(
        formatResult.cursorOffset,
      );
      inputEditor.setPosition(newPosition);
    });
  }
}
