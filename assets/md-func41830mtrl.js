/**
 * @file Stellar Tweaks - Main Application Logic
 * @author Kanao & Gemini
 * @version 3.12.3
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CORE LOGIC & CONFIGURATION ---
    let commandCounter = 0;
    let originalGamelist = '';
    const CONFIG_PATH = '/data/adb/.config/stellar/';
    const REBOOT_TOAST_MSG = "Reboot to take effect";

    const toggleFileMap = {
        "DonotDis": "dnd", "Litemode": "lite", "hibernateMode": "hibernate",
        "preloadGames": "preload", "skipPerformance": "skip_perf", "lowerDvfs": "dvfs_lower",
        "cpuMaxFreq": "max_freq_limit", "zetaTweak": "zt", "propRemoveTrace": "prop_trace",
        "sfLatencyV2": "sf_latency", "cmdRemoveTracer": "cmd_tracer", "sysTableReduceHeat": "sys_heat",
        "kernelTweakScheduler": "kernel_scheduler"
    };

    const selectFileMap = {
        "cpuGovernor": "custom_default_cpu_gov", "cpuGovernorGame": "custom_game_cpu_gov",
        "cpuGovernorPowersave": "custom_powersave_cpu_gov"
    };

    function executeCommand(command) {
        return new Promise((resolve) => {
            if (typeof ksu === 'undefined' || typeof ksu.exec !== 'function') {
                console.warn("KSU API not available for command:", command);
                return resolve({ errno: -1, stdout: '', stderr: 'KSU API not available' });
            }
            const callbackName = `exec_callback_${Date.now()}_${commandCounter++}`;
            window[callbackName] = (errno, stdout, stderr) => {
                delete window[callbackName];
                resolve({ errno, stdout, stderr });
            };
            try {
                ksu.exec(command, '{}', callbackName);
            } catch (e) {
                console.error("KSU execution error:", e.message);
                resolve({ errno: -1, stdout: '', stderr: e.message });
            }
        });
    }

    function showToast(message) {
        if (typeof ksu?.toast === 'function') {
            ksu.toast(message);
        } else {
            console.log("Toast:", message);
            const toastEl = document.getElementById('toast');
            if (toastEl) {
                toastEl.textContent = message;
                toastEl.classList.add('show');
                setTimeout(() => toastEl.classList.remove('show'), 3000);
            }
        }
    }

    // --- 2. DIALOG & POPUP LOGIC ---
    function openDialog(dialogId) {
        const dialog = document.getElementById(dialogId);
        if (dialog) {
            dialog.classList.add('active');
            document.body.classList.add('no-scroll');
        }
    }

    function closeDialog(dialogId) {
        const dialog = document.getElementById(dialogId);
        if (dialog) {
            dialog.classList.remove('active');
            document.body.classList.remove('no-scroll');
        }
    }

    // --- Gamelist Dialog Logic ---
    async function showGamelistDialog() {
        const input = document.getElementById("gamelistInput");
        const searchInput = document.getElementById("gamelistSearch");
        const { errno, stdout } = await executeCommand(`cat ${CONFIG_PATH}gamelist.json`);

        let listContent = '';
        if (errno === 0) {
            try {
                const data = JSON.parse(stdout);
                if (Array.isArray(data)) {
                    listContent = data.join("\n");
                } else if (data?.top_game_list) {
                    listContent = data.top_game_list.join("\n");
                } else {
                    listContent = stdout;
                }
            } catch {
                listContent = stdout;
            }
        }

        originalGamelist = listContent;
        input.textContent = originalGamelist;
        searchInput.value = '';
        openDialog('gamelistDialog');
    }

    async function saveGameList() {
        const packagesToSave = originalGamelist.split('\n').map(line => line.trim()).filter(Boolean);
        const jsonString = JSON.stringify(packagesToSave, null, 2);
        const command = `echo '${jsonString.replace(/'/g, "'\\''")}' > ${CONFIG_PATH}gamelist.json.tmp && mv ${CONFIG_PATH}gamelist.json.tmp ${CONFIG_PATH}gamelist.json`;
        await executeCommand(command);
        showToast(`Saved ${packagesToSave.length} packages`);
        closeDialog('gamelistDialog');
    }

    function filterGamelist() {
        const searchTerm = document.getElementById('gamelistSearch').value.toLowerCase();
        const gamelistInput = document.getElementById('gamelistInput');
        if (!searchTerm) {
            gamelistInput.textContent = originalGamelist;
            return;
        }
        const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedTerm})`, 'gi');
        const filteredAndHighlighted = originalGamelist
            .split('\n')
            .filter(line => line.toLowerCase().includes(searchTerm))
            .map(line => line.replace(regex, `<span class="highlight">$1</span>`))
            .join('\n');
        gamelistInput.innerHTML = filteredAndHighlighted;
    }
    
    function handleGamelistEdit() {
        const searchInput = document.getElementById('gamelistSearch');
        if (!searchInput.value) {
            originalGamelist = document.getElementById('gamelistInput').innerText;
        }
    }

    // --- 3. APP INITIALIZATION & DATA GETTERS ---
    async function initializeApp() {
        if (!await checkApiAvailability()) return;
        await Promise.all([
            checkModuleVersion(), checkServiceStatus(), getAndroidSDK(), getCurrentProfile(),
            getCPUABI(), getKernelVersion(), displayChipsetAndSoC(),
            ...Object.keys(toggleFileMap).map(id => checkToggleStatus(toggleFileMap[id], id)),
            loadCpuGovernors(),
        ]);
        setupEventListeners();
    }

    async function checkApiAvailability() {
        if (typeof ksu?.exec !== 'function') {
            openDialog('apiWarningPopup');
            return false;
        }
        return true;
    }

    async function checkModuleVersion() {
        let { stdout } = await executeCommand('grep "version=" /data/adb/modules/stellar/module.prop | awk -F\'=\' \'{print $2}\'');
        document.getElementById("moduleVer").textContent = stdout.trim();
    }

    async function checkServiceStatus() {
        const { errno, stdout } = await executeCommand("pidof stellars");
        document.getElementById("serviceStatus").textContent = (errno === 0 && stdout.trim()) ? "Awake ✨" : "Sleep 💤";
        document.getElementById("servicePID").textContent = (errno === 0 && stdout.trim()) ? `PID: ${stdout.trim()}` : "PID: N/A";
    }

    async function getAndroidSDK() {
        const { stdout: ver } = await executeCommand("getprop ro.build.version.release");
        const { stdout: sdk } = await executeCommand("getprop ro.build.version.sdk");
        document.getElementById("android_sdk").textContent = `${ver.trim()} (${sdk.trim()})`;
    }

    async function getCurrentProfile() {
        const { stdout } = await executeCommand(`cat ${CONFIG_PATH}lock`);
        const profileMap = { "perf": "Game", "def": "Normal", "pwr": "Battery" };
        document.getElementById("currentProfile").textContent = `${profileMap[stdout.trim()] || "Unknown"} Profile`;
    }

    async function getCPUABI() {
        const { stdout } = await executeCommand("getprop ro.product.cpu.abilist");
        document.getElementById("abis_arch").textContent = stdout.trim().split(',').map((abi, i) => i === 0 ? `${abi} (primary)` : abi).join(", ");
    }

    async function getKernelVersion() {
        const { stdout } = await executeCommand("uname -r");
        document.getElementById("kernel_version").textContent = stdout.trim();
    }

    async function displayChipsetAndSoC() {
        const socMap = { '1': "MediaTek", '2': "Snapdragon", '3': "Exynos", '4': "Unisoc", '0': "Unknown" };
        const [socResult, platformResult] = await Promise.all([
            executeCommand(`cat ${CONFIG_PATH}soc`),
            executeCommand("getprop ro.board.platform")
        ]);
        const socCode = socResult.stdout.trim();
        const platformName = platformResult.stdout.trim();
        const socName = socMap[socCode] || "Unknown";
        document.getElementById("chipset_name").textContent = `${socName} (${platformName})`;
    }
    
    // Generic Toggle Status Checker
    async function checkToggleStatus(file, elementId) {
        const { errno, stdout } = await executeCommand(`cat ${CONFIG_PATH}${file} 2>/dev/null`);
        const element = document.getElementById(elementId);
        if (element && errno === 0) element.checked = stdout.trim() === "1";
    }

    async function loadCpuGovernors() {
        const { stdout: values } = await executeCommand("cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors");
        const governors = values.trim().split(/\s+/).filter(Boolean);
        const selects = {
            "cpuGovernor": { file: selectFileMap.cpuGovernor, placeholder: "Select for Normal" },
            "cpuGovernorGame": { file: selectFileMap.cpuGovernorGame, placeholder: "Select for Game" },
            "cpuGovernorPowersave": { file: selectFileMap.cpuGovernorPowersave, placeholder: "Select for Powersave" }
        };
        for (const id in selects) {
            const selectEl = document.getElementById(id);
            if (selectEl) {
                const placeholder = `<option value="" disabled selected>${selects[id].placeholder}</option>`;
                selectEl.innerHTML = placeholder + governors.map(opt => `<option value="${opt}">${opt}</option>`).join('');
                const { stdout: current } = await executeCommand(`cat ${CONFIG_PATH}${selects[id].file} 2>/dev/null`);
                const currentValue = current.trim();
                if (currentValue && governors.includes(currentValue)) {
                    selectEl.value = currentValue;
                }
            }
        }
    }

    // --- 4. ACTION FUNCTIONS (Setters) ---
    async function setToggleStatus(file, enabled, showRebootToast = false) {
        await executeCommand(`echo ${enabled ? 1 : 0} > ${CONFIG_PATH}${file}`);
        if (showRebootToast) {
            showToast(REBOOT_TOAST_MSG);
        }
    }

    async function startService() {
        if ((await executeCommand("pgrep stellars")).stdout.trim()) {
            showToast("Daemon is already running");
            return;
        }
        await executeCommand("su -c 'stellars > /dev/null 2>&1 & disown'");
        showToast("Daemon started");
        setTimeout(checkServiceStatus, 1000);
    }
    const setSelectValue = (file, value) => executeCommand(`echo "${value}" > ${CONFIG_PATH}${file}`);

    // --- 5. IMPORT/EXPORT LOGIC ---
    async function exportConfig() {
        showToast("Exporting settings...");
        const settings = { toggles: {}, governors: {} };

        for (const id in toggleFileMap) {
            const element = document.getElementById(id);
            if (element) settings.toggles[id] = element.checked;
        }
        for (const id in selectFileMap) {
            const element = document.getElementById(id);
            if (element) settings.governors[id] = element.value;
        }
        
        const configData = {
            stellar_config_version: "1.0",
            exported_at: new Date().toISOString(),
            settings: settings
        };
        const jsonContent = JSON.stringify(configData, null, 2);
        const escapedJsonContent = jsonContent.replace(/'/g, "'\\''");

        // --- New Logic ---
        // 1. Create the timestamped backup in the Download folder
        const d = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const dateString = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        const backupFilename = `stellar_config_${dateString}.json`;
        const backupFullPath = `/storage/emulated/0/Download/${backupFilename}`;
        const backupCommand = `echo '${escapedJsonContent}' > ${backupFullPath}`;
        
        // 2. Create the simple, overwritable file in the default directory for easy sharing/import
        const simpleFilename = `stellar_config.json`;
        const simpleFullPath = `/storage/emulated/0/${simpleFilename}`;
        const simpleCommand = `echo '${escapedJsonContent}' > ${simpleFullPath}`;

        // Execute both commands
        const { errno: backupErrno } = await executeCommand(backupCommand);
        await executeCommand(simpleCommand);

        if (backupErrno === 0) {
            showToast(`Backup saved to Download folder`);
        } else {
            showToast("Export failed. Check storage permissions.");
        }
    }

    async function importConfig() {
        // This function remains simple: it only looks for the default file.
        const importPath = "/storage/emulated/0/stellar_config.json";
        showToast(`Attempting to import from ${importPath}...`);

        const { errno, stdout } = await executeCommand(`cat ${importPath}`);

        if (errno !== 0) {
            showToast("File not found. Place 'stellar_config.json' in internal storage and try again.");
            return;
        }

        try {
            const config = JSON.parse(stdout);
            if (!config.settings) throw new Error("Invalid config format");

            // Apply settings
            for (const [id, value] of Object.entries(config.settings.toggles)) {
                const element = document.getElementById(id);
                if (element) {
                    element.checked = value;
                    await setToggleStatus(toggleFileMap[id], value, false); // Don't show individual toasts
                }
            }
            for (const [id, value] of Object.entries(config.settings.governors)) {
                const element = document.getElementById(id);
                if (element) {
                    element.value = value;
                    await setSelectValue(selectFileMap[id], value);
                }
            }

            showToast("Import successful!");
            showToast("Reboot to apply all preference settings.");
        } catch (e) {
            showToast("Import failed: Invalid JSON format.");
            console.error("Import error:", e);
        }
    }


    // --- 6. EVENT LISTENERS ---
    function setupEventListeners() {
        const listen = (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler);

        // Dialogs
        listen("openAutomaticButton", "click", () => openDialog('automaticSettingsDialog'));
        listen("closeAutomaticSettings", "click", () => closeDialog('automaticSettingsDialog'));
        listen("openPreferenceButton", "click", () => openDialog('preferenceSettingsDialog'));
        listen("closePreferenceSettings", "click", () => closeDialog('preferenceSettingsDialog'));
        listen("aboutCard", "click", () => openDialog('aboutDialog'));
        listen("closeAboutDialog", "click", () => closeDialog('aboutDialog'));

        // Actions
        listen("startButton", "click", startService);
        listen("editGamelistButton", "click", showGamelistDialog);
        listen("importConfigButton", "click", importConfig);
        listen("exportConfigButton", "click", exportConfig);
        
        // Gamelist Dialog
        listen("gamelistSearch", "input", filterGamelist);
        listen("gamelistInput", "input", handleGamelistEdit);
        listen("saveGamelistButton", "click", saveGameList);
        listen("cancelGamelistButton", "click", () => closeDialog('gamelistDialog'));
        listen("closeGamelistButton", "click", () => closeDialog('gamelistDialog'));

        // Links and Warnings
        listen("donateButton", "click", () => executeCommand(`/system/bin/am start -a android.intent.action.VIEW -d https://github.com/kanaodnd/DonateMePls`));
        listen("supportLink", "click", () => executeCommand(`/system/bin/am start -a android.intent.action.VIEW -d https://github.com/kanaodnd/DonateMePls`));
        listen("closeApiWarning", "click", () => closeDialog('apiWarningPopup'));

        // Automatic Toggles
        const automaticToggles = ["DonotDis", "Litemode", "hibernateMode", "preloadGames", "skipPerformance", "lowerDvfs", "cpuMaxFreq"];
        automaticToggles.forEach(id => {
            listen(id, "change", (e) => setToggleStatus(toggleFileMap[id], e.target.checked, false));
        });
        
        // Preference Toggles (with reboot toast)
        const preferenceToggles = ["propRemoveTrace", "sfLatencyV2", "cmdRemoveTracer", "sysTableReduceHeat", "kernelTweakScheduler", "zetaTweak"];
        preferenceToggles.forEach(id => {
            listen(id, "change", (e) => setToggleStatus(toggleFileMap[id], e.target.checked, true));
        });

        // Selects
        Object.entries(selectFileMap).forEach(([id, file]) => {
            listen(id, "change", (e) => setSelectValue(file, e.target.value));
        });
    }

    // --- Let's Go! ---
    initializeApp();
});
