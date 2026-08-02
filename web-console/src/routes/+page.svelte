<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';

	let apiUrl = $state('http://localhost:3000');
	let apiKey = $state('zerotier_planet_secret_key_default_123');
	let systemStatus = $state('CHECKING...');
	let systemStatusClass = $state('tui-badge-warn');

	// Authentication State
	let isAuthenticated = $state(false);
	let loginUsername = $state('admin');
	let loginPassword = $state('admin');
	let loginError = $state('');
	let currentUserRole = $state('ADMIN');
	let sessionToken = $state('');

	// Members Management State (Admin only)
	let membersList = $state<any[]>([]);
	let newMemberUsername = $state('');
	let newMemberPassword = $state('');
	let newMemberRole = $state<'ADMIN' | 'OPERATOR' | 'READ_ONLY'>('OPERATOR');

	let logs = $state<string[]>(['[ SYSTEM INIT ] ZGalaxy Planet & Moon TUI Console Initialized.']);

	// Custom TUI Dialog / Modal System State (Zero Native Browser Dialogs)
	let dialogOpen = $state(false);
	let dialogTitle = $state('[ NOTICE ]');
	let dialogMessage = $state('');
	let dialogType = $state<'ALERT' | 'CONFIRM'>('ALERT');
	let onConfirmCallback = $state<(() => void) | null>(null);

	// Cloudflare DNS Management State
	let cfEnabled = $state(false);
	let cfMode = $state<'AUTOMATIC' | 'MANUAL'>('MANUAL');
	let cfApiToken = $state('');
	let cfApiTokenMasked = $state('');
	let cfHasToken = $state(false);
	let cfZoneId = $state('');
	let cfZoneName = $state('');
	let cfRecordId = $state('');
	let cfRecordName = $state('');
	let cfRecordType = $state<'A' | 'AAAA'>('A');
	let cfProxied = $state(false);
	let cfAutoRebuildPlanet = $state(true);
	let cfLastSyncedIp = $state('');
	let cfLastSyncedAt = $state('');

	let cfZonesList = $state<any[]>([]);
	let cfRecordsList = $state<any[]>([]);
	let cfSyncLogsList = $state<any[]>([]);

	// Multi-Planet Cluster Federation State
	let clusterTopology = $state<any>(null);
	let clusterNodesList = $state<any[]>([]);
	let newClusterNodeId = $state('');
	let newClusterNodeName = $state('');
	let newClusterNodeIp4 = $state('');
	let newClusterNodeDomain = $state('');
	let newClusterNodePort = $state(9994);

	// Moon Migration & Re-binding State
	let targetPlanetNodeId = $state('');
	let rebindEndpointsInput = $state('');

	// Federation Module & Token Engine State
	let fedTokensList = $state<any[]>([]);
	let fedPeersList = $state<any[]>([]);
	let fedLocalNodeId = $state('');
	let fedLocalEndpoint = $state('');

	let newFedTokenName = $state('');
	let newFedTokenMode = $state<'FEDERATION_INHERITED' | 'DIRECT_ISOLATED'>('FEDERATION_INHERITED');
	let newFedTokenMaxUses = $state(100);
	let newFedTokenExpiryDays = $state(365);

	let joinTargetEndpoint = $state('');
	let joinTokenSecret = $state('');
	let joinRequestedMode = $state<'FEDERATION_INHERITED' | 'DIRECT_ISOLATED'>('FEDERATION_INHERITED');

	function showCustomAlert(title: string, message: string) {
		dialogTitle = title;
		dialogMessage = message;
		dialogType = 'ALERT';
		onConfirmCallback = null;
		dialogOpen = true;
	}

	function showCustomConfirm(title: string, message: string, onConfirm: () => void) {
		dialogTitle = title;
		dialogMessage = message;
		dialogType = 'CONFIRM';
		onConfirmCallback = () => onConfirm();
		dialogOpen = true;
	}

	function closeDialog() {
		dialogOpen = false;
		onConfirmCallback = null;
	}

	function executeConfirm() {
		if (onConfirmCallback) {
			onConfirmCallback();
		}
		closeDialog();
	}

	// Network Addresses State (Internal & External separated)
	let internalIp4 = $state('192.168.1.100');
	let internalIp6 = $state('');
	let externalIp4 = $state('');
	let externalIp6 = $state('');

	// Domain & DDNS State
	let domainName = $state('');
	let domainStatus = $state('[ UNCHECKED ]');
	let ddnsConfig = $state<any>(null);

	// Planet State
	let planetPort = $state(9994);
	let planetInfo = $state<any>(null);

	// Moon State
	let moonName = $state('Moon-Node-1');
	let moonEndpoints = $state('10.0.0.1/9993');
	let moonsList = $state<any[]>([]);

	// Identity State
	let identityInfo = $state<any>(null);

	function logMessage(msg: string) {
		const timestamp = new Date().toISOString().substring(11, 19);
		logs = [`[${timestamp}] ${msg}`, ...logs.slice(0, 49)];
	}

	async function apiRequest(endpoint: string, method = 'GET', body: any = null, customHeaders: Record<string, string> = {}) {
		try {
			logMessage(`[ ZGALAXY API REQ ] ${method} ${endpoint}`);
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${sessionToken || apiKey}`,
				...customHeaders
			};

			const options: RequestInit = { method, headers };
			if (body) options.body = JSON.stringify(body);

			const res = await fetch(`${apiUrl}${endpoint}`, options);
			const data = await res.json();
			logMessage(`[ ZGALAXY API RES ${res.status} ] ${JSON.stringify(data)}`);
			return data;
		} catch (err: any) {
			logMessage(`[ ZGALAXY API ERROR ] ${err.message}`);
			return null;
		}
	}

	async function handleLogin() {
		loginError = '';
		logMessage(`[ ACTION ] Authenticating user '${loginUsername}'...`);

		const res = await apiRequest('/api/v1/auth/login', 'POST', {
			username: loginUsername,
			password: loginPassword
		});

		if (res && res.success && res.data) {
			sessionToken = res.data.token;
			currentUserRole = res.data.role;
			isAuthenticated = true;
			logMessage(`[ SUCCESS ] Logged in as ${res.data.username} [ROLE: ${res.data.role}]`);
			await loadDashboardData();
		} else {
			loginError = res?.error || 'Authentication failed. Check username and password or API URL.';
			logMessage(`[ FAIL ] Login failed: ${loginError}`);
		}
	}

	function handleLogout() {
		isAuthenticated = false;
		sessionToken = '';
		currentUserRole = '';
		logMessage('[ ACTION ] User logged out.');
	}

	// Federation Module & Token Engine Methods
	async function fetchFederationTokens() {
		const res = await apiRequest('/api/v1/federation/tokens');
		if (res && res.success && res.data) {
			fedTokensList = res.data;
		}
	}

	async function handleCreateFederationToken() {
		if (!newFedTokenName || newFedTokenName.trim().length === 0) {
			showCustomAlert('[ INPUT REQUIRED ]', 'Please enter a name for the Federation Token.');
			return;
		}

		logMessage(`[ ACTION ] Generating new Federation Token '${newFedTokenName}' [MODE: ${newFedTokenMode}]...`);
		const res = await apiRequest('/api/v1/federation/tokens/create', 'POST', {
			name: newFedTokenName,
			syncMode: newFedTokenMode,
			maxUses: Number(newFedTokenMaxUses) || 100,
			expiresInDays: Number(newFedTokenExpiryDays) || 365,
			permissions: ['READ', 'WRITE', 'PLANET_SYNC', 'MOON_SYNC']
		});

		if (res && res.success && res.data) {
			showCustomAlert(
				'[ TOKEN GENERATED ]',
				`Federation Token '${res.data.name}' generated successfully!\n\nTOKEN SECRET:\n${res.data.tokenSecret}\n\n(Copy and share this token securely with joining nodes)`
			);
			newFedTokenName = '';
			await fetchFederationTokens();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to generate Federation Token.');
		}
	}

	async function handleRevokeFederationToken(tokenId: string) {
		showCustomConfirm('[ CONFIRM REVOKE ]', `Are you sure you want to permanently revoke token '${tokenId}'?`, async () => {
			logMessage(`[ ACTION ] Revoking token '${tokenId}'...`);
			const res = await apiRequest(`/api/v1/federation/tokens/${tokenId}/revoke`, 'POST');
			if (res && res.success) {
				showCustomAlert('[ TOKEN REVOKED ]', `Token ${tokenId} has been revoked.`);
				await fetchFederationTokens();
			} else {
				showCustomAlert('[ ERROR ]', res?.error || 'Failed to revoke token.');
			}
		});
	}

	async function handleRenewFederationToken(tokenId: string) {
		logMessage(`[ ACTION ] Extending token '${tokenId}' expiration by 30 days...`);
		const res = await apiRequest(`/api/v1/federation/tokens/${tokenId}/renew`, 'POST', { extensionDays: 30 });
		if (res && res.success) {
			showCustomAlert('[ TOKEN RENEWED ]', `Token ${tokenId} expiration extended by 30 days.`);
			await fetchFederationTokens();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to renew token.');
		}
	}

	async function fetchFederationPeers() {
		const res = await apiRequest('/api/v1/federation/peers');
		if (res && res.success && res.data) {
			fedLocalNodeId = res.data.localNodeId || '';
			fedLocalEndpoint = res.data.localEndpoint || '';
			fedPeersList = res.data.peers || [];
		}
	}

	async function handleJoinFederation() {
		if (!joinTargetEndpoint || !joinTokenSecret) {
			showCustomAlert('[ INPUT REQUIRED ]', 'Target Endpoint URL and Token Secret are required.');
			return;
		}

		logMessage(`[ ACTION ] Joining remote Federation node at '${joinTargetEndpoint}' [MODE: ${joinRequestedMode}]...`);
		const res = await apiRequest('/api/v1/federation/join', 'POST', {
			targetEndpoint: joinTargetEndpoint,
			tokenSecret: joinTokenSecret,
			syncMode: joinRequestedMode
		});

		if (res && res.success && res.data) {
			showCustomAlert('[ FEDERATION JOINED ]', res.data.message || 'Joined Federation network successfully.');
			joinTargetEndpoint = '';
			joinTokenSecret = '';
			await fetchFederationPeers();
		} else {
			showCustomAlert('[ JOIN FAILED ]', res?.error || 'Failed to join remote Federation node.');
		}
	}

	async function handleDisconnectPeer(nodeId: string) {
		showCustomConfirm('[ CONFIRM DISCONNECT ]', `Are you sure you want to disconnect peer node '${nodeId}'?`, async () => {
			logMessage(`[ ACTION ] Disconnecting peer '${nodeId}'...`);
			const res = await apiRequest(`/api/v1/federation/peers/${nodeId}`, 'DELETE');
			if (res && res.success) {
				showCustomAlert('[ PEER DISCONNECTED ]', `Peer node ${nodeId} has been disconnected.`);
				await fetchFederationPeers();
			} else {
				showCustomAlert('[ ERROR ]', res?.error || 'Failed to disconnect peer.');
			}
		});
	}

	async function handlePropagateMeshNow() {
		logMessage('[ ACTION ] Triggering manual mesh topology propagation...');
		const res = await apiRequest('/api/v1/federation/sync-now', 'POST');
		if (res && res.success) {
			showCustomAlert('[ MESH PROPAGATED ]', 'Mesh topology propagation completed across active peers.');
			await fetchFederationPeers();
		}
	}

	// Multi-Planet Cluster Federation Methods
	async function fetchClusterTopology() {
		const res = await apiRequest('/api/v1/cluster/status');
		if (res && res.success && res.data) {
			clusterTopology = res.data;
			clusterNodesList = res.data.nodes || [];
		}
	}

	async function handleAddClusterNode() {
		if (!newClusterNodeId || !newClusterNodeIp4) {
			showCustomAlert('[ INPUT REQUIRED ]', 'Node ID and IPv4 address are required.');
			return;
		}

		logMessage(`[ ACTION ] Registering cluster node '${newClusterNodeId}'...`);
		const res = await apiRequest('/api/v1/cluster/nodes/add', 'POST', {
			nodeId: newClusterNodeId,
			name: newClusterNodeName || `Planet-${newClusterNodeId}`,
			ip4: newClusterNodeIp4,
			domain: newClusterNodeDomain,
			port: Number(newClusterNodePort) || 9994
		});

		if (res && res.success) {
			showCustomAlert('[ CLUSTER NODE ADDED ]', `Federated Planet node ${newClusterNodeId} added successfully.`);
			newClusterNodeId = '';
			newClusterNodeName = '';
			newClusterNodeIp4 = '';
			newClusterNodeDomain = '';
			await fetchClusterTopology();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to add cluster node.');
		}
	}

	async function handleRemoveClusterNode(nodeId: string) {
		showCustomConfirm('[ CONFIRM REMOVE ]', `Are you sure you want to remove Planet node '${nodeId}' from the cluster?`, async () => {
			logMessage(`[ ACTION ] Removing node '${nodeId}' from cluster...`);
			const res = await apiRequest(`/api/v1/cluster/nodes/${nodeId}`, 'DELETE');
			if (res && res.success) {
				showCustomAlert('[ NODE REMOVED ]', `Node ${nodeId} removed from cluster.`);
				await fetchClusterTopology();
			} else {
				showCustomAlert('[ ERROR ]', res?.error || 'Failed to remove node.');
			}
		});
	}

	async function handleSyncClusterNodes() {
		logMessage('[ ACTION ] Synchronizing federated cluster nodes...');
		const res = await apiRequest('/api/v1/cluster/sync', 'POST');
		if (res && res.success) {
			showCustomAlert('[ CLUSTER SYNC COMPLETE ]', 'All federated Planet nodes have been synchronized.');
			await fetchClusterTopology();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to sync cluster nodes.');
		}
	}

	async function handleBuildUnifiedClusterPlanet() {
		logMessage('[ ACTION ] Compiling unified multi-root Planet binary...');
		const res = await apiRequest('/api/v1/cluster/build-unified', 'POST');
		if (res && res.success && res.data) {
			showCustomAlert('[ UNIFIED PLANET BUILT ]', res.data.message || 'Unified Cluster Planet binary compiled successfully.');
			await fetchPlanetInfo();
			await fetchClusterTopology();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to build unified Planet binary.');
		}
	}

	async function handleMigrateMoon(moonId: string) {
		if (!targetPlanetNodeId) {
			showCustomAlert('[ INPUT REQUIRED ]', 'Please specify a target Planet Node ID for migration.');
			return;
		}

		logMessage(`[ ACTION ] Migrating Moon '${moonId}' to Planet node '${targetPlanetNodeId}'...`);
		const res = await apiRequest(`/api/v1/moons/${moonId}/migrate`, 'POST', { targetPlanetId: targetPlanetNodeId });
		if (res && res.success) {
			showCustomAlert('[ MOON MIGRATED ]', `Moon ${moonId} migrated successfully to target Planet ${targetPlanetNodeId}.`);
			targetPlanetNodeId = '';
			await fetchMoons();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to migrate Moon node.');
		}
	}

	async function handleRebindMoon(moonId: string) {
		if (!rebindEndpointsInput || rebindEndpointsInput.trim().length === 0) {
			showCustomAlert('[ INPUT REQUIRED ]', 'Please provide at least one endpoint for re-binding.');
			return;
		}

		const endpointsArr = rebindEndpointsInput.split(',').map((e) => e.trim()).filter((e) => e.length > 0);
		logMessage(`[ ACTION ] Re-binding Moon '${moonId}' to endpoints: ${endpointsArr.join(', ')}...`);
		const res = await apiRequest(`/api/v1/moons/${moonId}/rebind`, 'POST', { endpoints: endpointsArr });
		if (res && res.success) {
			showCustomAlert('[ MOON RE-BOUND ]', `Moon ${moonId} endpoints re-bound successfully.`);
			rebindEndpointsInput = '';
			await fetchMoons();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to re-bind Moon endpoints.');
		}
	}

	// Cloudflare API Methods
	async function fetchCloudflareConfig() {
		const res = await apiRequest('/api/v1/cloudflare/config');
		if (res && res.success && res.data) {
			const d = res.data;
			cfEnabled = d.enabled;
			cfMode = d.mode || 'MANUAL';
			cfApiTokenMasked = d.apiTokenMasked || '';
			cfHasToken = d.hasApiToken;
			cfZoneId = d.zoneId || '';
			cfZoneName = d.zoneName || '';
			cfRecordId = d.recordId || '';
			cfRecordName = d.recordName || '';
			cfRecordType = d.recordType || 'A';
			cfProxied = Boolean(d.proxied);
			cfAutoRebuildPlanet = Boolean(d.autoRebuildPlanet);
			cfLastSyncedIp = d.lastSyncedIp || '';
			cfLastSyncedAt = d.lastSyncedAt || '';

			const fullCfDomain = cfRecordName
				? (cfRecordName.includes('.') ? cfRecordName : `${cfRecordName}.${cfZoneName}`)
				: cfZoneName;

			if (fullCfDomain && (!domainName || domainName === 'planet.example.com')) {
				domainName = fullCfDomain;
			}

			if (cfHasToken && cfMode === 'AUTOMATIC') {
				await handleFetchCloudflareZones();
			}
		}
	}

	async function handleSaveCloudflareConfig() {
		logMessage('[ ACTION ] Saving Cloudflare DNS configuration...');
		const payload: any = {
			enabled: cfEnabled,
			mode: cfMode,
			zoneId: cfZoneId,
			zoneName: cfZoneName,
			recordId: cfRecordId,
			recordName: cfRecordName,
			recordType: cfRecordType,
			proxied: cfProxied,
			autoRebuildPlanet: cfAutoRebuildPlanet
		};

		if (cfApiToken && cfApiToken.trim().length > 0) {
			payload.apiToken = cfApiToken.trim();
		}

		const res = await apiRequest('/api/v1/cloudflare/config', 'POST', payload);
		if (res && res.success) {
			logMessage('[ SUCCESS ] Cloudflare configuration saved.');
			showCustomAlert('[ CLOUDFLARE CONFIG SAVED ]', 'Cloudflare DNS configuration has been saved successfully.');
			cfApiToken = '';

			const fullCfDomain = cfRecordName
				? (cfRecordName.includes('.') ? cfRecordName : `${cfRecordName}.${cfZoneName}`)
				: cfZoneName;
			if (fullCfDomain) {
				domainName = fullCfDomain;
			}

			await fetchCloudflareConfig();
			await fetchCloudflareLogs();
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to save Cloudflare configuration.');
		}
	}

	async function handleVerifyCloudflareToken() {
		logMessage('[ ACTION ] Verifying Cloudflare API Token with Cloudflare servers...');
		const tokenToTest = cfApiToken && cfApiToken.trim().length > 0 ? cfApiToken.trim() : 'KEEP_SAME';
		const res = await apiRequest('/api/v1/cloudflare/verify-token', 'POST', { apiToken: tokenToTest });
		if (res && res.success) {
			if (res.isValid) {
				showCustomAlert('[ TOKEN VERIFIED ]', 'Cloudflare API Token is VALID and active.');
				if (cfMode === 'AUTOMATIC') {
					await handleFetchCloudflareZones();
				}
			} else {
				showCustomAlert('[ INVALID TOKEN ]', 'Cloudflare API Token verification FAILED. Please check permissions.');
			}
		} else {
			showCustomAlert('[ ERROR ]', res?.error || 'Failed to verify Cloudflare Token.');
		}
	}

	async function handleFetchCloudflareZones() {
		logMessage('[ ACTION ] Retrieving available Zones (Domains) from Cloudflare...');
		const customHeader = cfApiToken ? { 'x-cloudflare-token': cfApiToken.trim() } : {};
		const res = await apiRequest('/api/v1/cloudflare/zones', 'GET', null, customHeader);
		if (res && res.success && res.data) {
			cfZonesList = res.data;
			logMessage(`[ SUCCESS ] Fetched ${cfZonesList.length} Cloudflare zones.`);
			if (cfZoneId) {
				await handleZoneSelect(cfZoneId);
			}
		}
	}

	async function handleZoneSelect(zoneId: string) {
		cfZoneId = zoneId;
		const selectedZone = cfZonesList.find((z) => z.id === zoneId);
		if (selectedZone) {
			cfZoneName = selectedZone.name;
			if (!cfRecordName) {
				domainName = selectedZone.name;
			}
		}

		if (zoneId) {
			logMessage(`[ ACTION ] Fetching DNS records for Zone ID '${zoneId}'...`);
			const customHeader = cfApiToken ? { 'x-cloudflare-token': cfApiToken.trim() } : {};
			const res = await apiRequest(`/api/v1/cloudflare/zones/${zoneId}/records`, 'GET', null, customHeader);
			if (res && res.success && res.data) {
				cfRecordsList = res.data;
			}
		}
	}

	function handleRecordSelect(recordId: string) {
		cfRecordId = recordId;
		const selected = cfRecordsList.find((r) => r.id === recordId);
		if (selected) {
			cfRecordName = selected.name;
			cfRecordType = selected.type;
			cfProxied = Boolean(selected.proxied);
			domainName = selected.name;
		}
	}

	async function handleForceCloudflareSync() {
		logMessage('[ ACTION ] Triggering immediate Cloudflare DNS synchronization...');
		const res = await apiRequest('/api/v1/cloudflare/sync', 'POST');
		if (res && res.success && res.data) {
			showCustomAlert('[ CLOUDFLARE SYNC RESULT ]', res.data.message);
			await fetchCloudflareConfig();
			await fetchCloudflareLogs();
			await fetchPlanetInfo();
		} else {
			showCustomAlert('[ SYNC FAILED ]', res?.error || 'Cloudflare DNS synchronization failed.');
		}
	}

	async function fetchCloudflareLogs() {
		const res = await apiRequest('/api/v1/cloudflare/logs');
		if (res && res.success) {
			cfSyncLogsList = res.data;
		}
	}

	async function handleClearCloudflareLogs() {
		showCustomConfirm(
			'[ CLEAR SYNC LOGS ]',
			'Are you sure you want to permanently clear all Cloudflare sync history logs?',
			async () => {
				const res = await apiRequest('/api/v1/cloudflare/logs', 'DELETE');
				if (res && res.success) {
					cfSyncLogsList = [];
					logMessage('[ SUCCESS ] Cloudflare sync logs cleared.');
					showCustomAlert('[ LOGS CLEARED ]', 'All Cloudflare sync history logs have been cleared.');
				} else {
					showCustomAlert('[ ERROR ]', res?.error || 'Failed to clear Cloudflare sync logs.');
				}
			}
		);
	}

	async function fetchMembers() {
		if (currentUserRole !== 'ADMIN') return;
		const res = await apiRequest('/api/v1/auth/users');
		if (res && res.success) {
			membersList = res.data;
		}
	}

	async function handleCreateMember() {
		if (!newMemberUsername || !newMemberPassword) {
			showCustomAlert('[ INPUT REQUIRED ]', 'Member username and password are required.');
			return;
		}

		logMessage(`[ ACTION ] Adding new member '${newMemberUsername}' with role [${newMemberRole}]...`);
		const res = await apiRequest('/api/v1/auth/users/create', 'POST', {
			username: newMemberUsername,
			password: newMemberPassword,
			role: newMemberRole
		});

		if (res && res.success) {
			logMessage(`[ SUCCESS ] Member '${newMemberUsername}' created successfully.`);
			showCustomAlert('[ MEMBER CREATED ]', `Member '${newMemberUsername}' created successfully with role ${newMemberRole}.`);
			newMemberUsername = '';
			newMemberPassword = '';
			await fetchMembers();
		} else {
			showCustomAlert('[ CREATION FAILED ]', res?.error || 'Failed to create member.');
		}
	}

	async function handleDeleteMember(username: string) {
		showCustomConfirm(
			'[ CONFIRM MEMBER DELETION ]',
			`Are you sure you want to permanently delete member '${username}'?`,
			async () => {
				const res = await apiRequest(`/api/v1/auth/users/${username}`, 'DELETE');
				if (res && res.success) {
					logMessage(`[ SUCCESS ] Member '${username}' deleted.`);
					showCustomAlert('[ DELETED ]', `Member '${username}' has been deleted.`);
					await fetchMembers();
				}
			}
		);
	}

	async function checkHealth() {
		const res = await apiRequest('/api/v1/health');
		if (res && res.status === 'ok') {
			systemStatus = '[ ONLINE ]';
			systemStatusClass = 'tui-badge-ok';
		} else {
			systemStatus = '[ OFFLINE / UNREACHABLE ]';
			systemStatusClass = 'tui-badge-error';
		}
	}

	async function autoDetectAddresses() {
		logMessage('[ ACTION ] Fetching network addresses from ZGalaxy Engine...');
		const res = await apiRequest('/api/v1/network/addresses');
		if (res && res.success && res.data) {
			const addrs = res.data;
			if (addrs.internal?.ip4?.length > 0) internalIp4 = addrs.internal.ip4[0];
			if (addrs.internal?.ip6?.length > 0) internalIp6 = addrs.internal.ip6[0];
			if (addrs.external?.ip4) externalIp4 = addrs.external.ip4;
			if (addrs.external?.ip6) externalIp6 = addrs.external.ip6;
			logMessage('[ SUCCESS ] Network addresses populated.');
		}
	}

	async function fetchDDNSStatus() {
		const res = await apiRequest('/api/v1/ddns/status');
		if (res && res.success) {
			ddnsConfig = res.data;
			if (res.data.domain && !domainName) {
				domainName = res.data.domain;
			}
		}
	}

	async function handleForceDDNSSync() {
		logMessage('[ ACTION ] Executing ZGalaxy DDNS IP change sync...');
		const res = await apiRequest('/api/v1/ddns/sync', 'POST');
		if (res && res.success) {
			logMessage(`[ DDNS SYNC ] ${res.data.message}`);
			showCustomAlert('[ DDNS SYNC RESULT ]', res.data.message);
			await fetchDDNSStatus();
			await fetchPlanetInfo();
		}
	}

	async function handleVerifyDomain() {
		logMessage(`[ ACTION ] Verifying DNS resolution for domain: ${domainName}...`);
		const res = await apiRequest('/api/v1/domains/verify', 'POST', { domain: domainName });
		if (res && res.success && res.data) {
			if (res.data.isResolvable) {
				domainStatus = `[ RESOLVED: IPv4=${res.data.resolvedIp4.join(', ') || 'NONE'} ]`;
				logMessage(`[ SUCCESS ] Domain ${domainName} is resolvable.`);
				showCustomAlert('[ DNS VERIFIED ]', `Domain ${domainName} resolved successfully.\nResolved IPv4: ${res.data.resolvedIp4.join(', ') || 'NONE'}`);
			} else {
				domainStatus = '[ DNS RESOLUTION FAILED ]';
				logMessage(`[ WARN ] Domain ${domainName} could not be resolved by DNS.`);
				showCustomAlert('[ DNS FAILED ]', `Domain ${domainName} could not be resolved by DNS.`);
			}
		}
	}

	async function handleBindDomain() {
		logMessage(`[ ACTION ] Binding domain ${domainName} to ZGalaxy Planet...`);
		const res = await apiRequest('/api/v1/domains/bind', 'POST', { domain: domainName, target: 'PLANET' });
		if (res && res.success) {
			domainStatus = `[ BOUND TO PLANET ]`;
			logMessage(`[ SUCCESS ] Domain ${domainName} successfully bound.`);
			showCustomAlert('[ DOMAIN BOUND ]', `Domain ${domainName} has been bound to Planet service.`);
			await apiRequest('/api/v1/ddns/config', 'POST', { domain: domainName });
			await fetchDDNSStatus();
		}
	}

	async function fetchPlanetInfo() {
		const res = await apiRequest('/api/v1/planet/info');
		if (res && res.success) {
			planetInfo = res.data;
			if (res.data.ip4) internalIp4 = res.data.ip4;
			if (res.data.ip6) internalIp6 = res.data.ip6;
			if (res.data.domain) domainName = res.data.domain;
		}
	}

	async function handleBuildPlanet() {
		logMessage('[ ACTION ] Initiating ZGalaxy Planet build process...');
		const res = await apiRequest('/api/v1/planet/build', 'POST', {
			ip4: externalIp4 || internalIp4,
			ip6: externalIp6 || internalIp6,
			domain: domainName,
			port: Number(planetPort)
		});
		if (res && res.success) {
			logMessage('[ SUCCESS ] ZGalaxy Planet built successfully!');
			showCustomAlert('[ PLANET BUILT ]', 'ZGalaxy Planet binary and configurations built successfully!');
			await fetchPlanetInfo();
		}
	}

	async function handleValidatePlanet() {
		const res = await apiRequest('/api/v1/planet/validate', 'POST');
		if (res && res.success) {
			showCustomAlert('[ PLANET VALIDATION RESULT ]', JSON.stringify(res.data, null, 2));
		}
	}

	async function fetchMoons() {
		const res = await apiRequest('/api/v1/moons');
		if (res && res.success) {
			moonsList = res.data;
		}
	}

	async function handleCreateMoon() {
		logMessage('[ ACTION ] Creating new ZGalaxy Moon node...');
		const endpointsArr = moonEndpoints.split(',').map((e) => e.trim());
		const res = await apiRequest('/api/v1/moons/create', 'POST', {
			name: moonName,
			endpoints: endpointsArr
		});
		if (res) {
			logMessage('[ SUCCESS ] Moon generated successfully!');
			showCustomAlert('[ MOON GENERATED ]', `Moon node '${moonName}' created successfully.`);
			await fetchMoons();
		}
	}

	async function handleDeleteMoon(moonFileName: string) {
		showCustomConfirm('[ CONFIRM MOON DELETION ]', `Are you sure you want to delete Moon file '${moonFileName}'?`, async () => {
			const res = await apiRequest(`/api/v1/moons/${moonFileName}`, 'DELETE');
			if (res && res.success) {
				showCustomAlert('[ MOON DELETED ]', `Moon node '${moonFileName}' deleted.`);
				await fetchMoons();
			}
		});
	}

	async function fetchIdentityStatus() {
		const res = await apiRequest('/api/v1/identity/status');
		if (res && res.success) {
			identityInfo = res.data;
		}
	}

	async function handleRotateKeys() {
		showCustomConfirm(
			'[ CONFIRM KEY ROTATION ]',
			'Are you sure you want to rotate identity keys and certificates? This will generate a brand new identity.',
			async () => {
				await apiRequest('/api/v1/identity/rotate', 'POST');
				showCustomAlert('[ KEYS ROTATED ]', 'Identity keys and certificates rotated successfully.');
				await fetchIdentityStatus();
			}
		);
	}

	async function handleVerifyIdentity() {
		const res = await apiRequest('/api/v1/identity/verify', 'POST');
		if (res && res.success) {
			showCustomAlert('[ IDENTITY INTEGRITY REPORT ]', JSON.stringify(res.data, null, 2));
		}
	}

	async function handleExportBackup() {
		logMessage('[ ACTION ] Exporting ZGalaxy infrastructure backup archive...');
		const res = await apiRequest('/api/v1/backup/export', 'POST');
		if (res && res.success) {
			logMessage(`[ SUCCESS ] Backup created at: ${res.backupPath}`);
			showCustomAlert('[ BACKUP EXPORTED ]', `Full infrastructure backup exported successfully.\nPath: ${res.backupPath}`);
		}
	}

	async function loadDashboardData() {
		await checkHealth();
		await autoDetectAddresses();
		await fetchPlanetInfo();
		await fetchClusterTopology();
		await fetchFederationTokens();
		await fetchFederationPeers();
		await fetchDDNSStatus();
		await fetchCloudflareConfig();
		await fetchCloudflareLogs();
		await fetchMoons();
		await fetchIdentityStatus();
		await fetchMembers();
	}

	onMount(async () => {
		if (typeof window !== 'undefined' && window.location.hostname) {
			apiUrl = `${window.location.protocol}//${window.location.hostname}:3000`;
		}
		await checkHealth();
	});
</script>

<main>
	<!-- REUSABLE CUSTOM TUI MODAL / DIALOG -->
	{#if dialogOpen}
		<div class="tui-modal-overlay">
			<div class="tui-box tui-modal-box">
				<div class="tui-header" style="display: flex; align-items: center; gap: 8px;">
					<img src="/logo.svg" alt="ZGalaxy Logo" style="height: 18px; width: auto;" />
					<span>┌── {dialogTitle}</span>
				</div>
				<div class="tui-body">
					<p class="tui-modal-msg">{dialogMessage}</p>
					<div class="tui-modal-actions">
						{#if dialogType === 'CONFIRM'}
							<button class="tui-btn tui-btn-danger" onclick={executeConfirm}>[ CONFIRM ]</button>
							<button class="tui-btn" onclick={closeDialog}>[ CANCEL ]</button>
						{:else}
							<button class="tui-btn tui-btn-success" onclick={closeDialog}>[ OK ]</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if !isAuthenticated}
		<!-- TUI LOGIN GATEWAY SCREEN -->
		<div style="max-width: 540px; margin: 40px auto;">
			<div class="tui-box">
				<div class="tui-header" style="display: flex; align-items: center; gap: 10px;">
					<img src="/logo.svg" alt="ZGalaxy Logo" style="height: 24px; width: auto;" />
					<span>┌── [ ZGALAXY - SECURE AUTHENTICATION GATEWAY ]</span>
				</div>
				<div class="tui-body">
					<p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
						Enter your member credentials to access the ZGalaxy Infrastructure Management Console.
					</p>

					{#if loginError}
						<div class="tui-badge tui-badge-error" style="display: block; margin-bottom: 14px; padding: 6px 10px;">
							[ ERROR: {loginError} ]
						</div>
					{/if}

					<div style="margin-bottom: 12px;">
						<label for="loginUsernameInput" style="color: var(--accent-gold);">[ MEMBER USERNAME ]</label>
						<input id="loginUsernameInput" type="text" class="tui-input" bind:value={loginUsername} placeholder="admin" style="margin-top: 4px;" />
					</div>

					<div style="margin-bottom: 16px;">
						<label for="loginPasswordInput" style="color: var(--accent-gold);">[ MEMBER PASSWORD ]</label>
						<input id="loginPasswordInput" type="password" class="tui-input" bind:value={loginPassword} placeholder="admin" style="margin-top: 4px;" />
					</div>

					<button class="tui-btn tui-btn-success" onclick={handleLogin} style="width: 100%; text-align: center; padding: 10px;">
						[ AUTHENTICATE & ENTER CONSOLE ]
					</button>

					<div style="margin-top: 14px; font-size: 11px; color: var(--text-muted); text-align: center;">
						Default Master Credentials: username: <span style="color: var(--accent-gold);">admin</span> | password: <span style="color: var(--accent-gold);">admin</span>
					</div>

					<div style="margin-top: 16px; border-top: 1px dashed var(--border-color); pt-12px; font-size: 11px; color: var(--text-muted); text-align: center;">
						PROJECT: <span style="color: var(--accent-gold);">ZGALAXY</span> | LICENSE: <span style="color: var(--accent-gold);">AGPL-3.0</span> | DISCORD: <span style="color: var(--accent-gold);">yuuyu_gg</span>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- DASHBOARD CONSOLE (AUTHENTICATED) -->

		<!-- Header Bar -->
		<div class="tui-box">
			<div class="tui-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
				<div style="display: flex; align-items: center; gap: 10px;">
					<img src="/logo.svg" alt="ZGalaxy Logo" style="height: 22px; width: auto;" />
					<span>┌── [ ZGALAXY CONSOLE | USER: {loginUsername.toUpperCase()} | ROLE: {currentUserRole} ]</span>
				</div>
				<button class="tui-btn tui-btn-danger" onclick={handleLogout} style="padding: 2px 8px; font-size: 11px;">
					[ LOGOUT ]
				</button>
			</div>
			<div class="tui-body">
				<div class="grid-2">
					<div>
						<label for="apiUrlInput" style="color: var(--accent-gold);">[ ZGALAXY ENGINE API URL ]</label>
						<input id="apiUrlInput" type="text" class="tui-input" bind:value={apiUrl} style="margin-top: 4px;" />
					</div>
					<div>
						<label for="apiKeyInput" style="color: var(--accent-gold);">[ ACTIVE SESSION TOKEN ]</label>
						<input id="apiKeyInput" type="password" class="tui-input" bind:value={sessionToken} readonly style="margin-top: 4px;" />
					</div>
				</div>
				<div style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between;">
					<div>
						<span style="color: var(--text-muted);">SYSTEM HEALTH: </span>
						<span class="tui-badge {systemStatusClass}">{systemStatus}</span>
					</div>
					<button class="tui-btn" onclick={checkHealth}>[ RECHECK SERVER ]</button>
				</div>
			</div>
		</div>

		<!-- FEDERATION MANAGER & TOKEN ENGINE PANEL -->
		<div class="tui-box">
			<div class="tui-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
				<div>┌── [ ZGALAXY DECENTRALIZED FEDERATION & TOKEN ENGINE ]</div>
				<div>
					<span style="color: var(--text-muted); font-size: 12px; margin-right: 8px;">LOCAL NODE ID:</span>
					<span class="tui-badge tui-badge-ok">[{fedLocalNodeId || 'INITIALIZING'}]</span>
				</div>
			</div>
			<div class="tui-body">
				<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
					<button class="tui-btn tui-btn-success" onclick={handlePropagateMeshNow}>[ FORCE MESH PROPAGATION NOW ]</button>
					<button class="tui-btn" onclick={fetchFederationTokens}>[ REFRESH TOKENS ]</button>
					<button class="tui-btn" onclick={fetchFederationPeers}>[ REFRESH PEERS ]</button>
				</div>

				<div class="grid-2" style="margin-bottom: 16px;">
					<!-- Generate Federation Token Form -->
					{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
						<div style="background: #08080c; border: 1px solid var(--border-color); padding: 12px;">
							<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 8px;">[ + GENERATE FEDERATION TOKEN ]</div>
							<div style="margin-bottom: 8px;">
								<label for="newFedTokenNameInput">[ TOKEN NAME / DESCRIPTION ]</label>
								<input id="newFedTokenNameInput" type="text" class="tui-input" bind:value={newFedTokenName} placeholder="e.g. Regional Mesh Token" style="margin-top: 4px;" />
							</div>

							<div style="margin-bottom: 8px;">
								<label for="newFedTokenModeSelect">[ SYNCHRONIZATION MODE ]</label>
								<select id="newFedTokenModeSelect" class="tui-input" bind:value={newFedTokenMode} style="margin-top: 4px;">
									<option value="FEDERATION_INHERITED">FEDERATION_INHERITED (Auto Peer Discovery Mesh)</option>
									<option value="DIRECT_ISOLATED">DIRECT_ISOLATED (Strict Point-to-Point Isolation)</option>
								</select>
							</div>

							<div class="grid-2" style="margin-bottom: 12px;">
								<div>
									<label for="newFedTokenMaxUsesInput">[ MAX ALLOWED USES ]</label>
									<input id="newFedTokenMaxUsesInput" type="number" class="tui-input" bind:value={newFedTokenMaxUses} style="margin-top: 4px;" />
								</div>
								<div>
									<label for="newFedTokenExpiryDaysInput">[ EXPIRATION (DAYS) ]</label>
									<input id="newFedTokenExpiryDaysInput" type="number" class="tui-input" bind:value={newFedTokenExpiryDays} style="margin-top: 4px;" />
								</div>
							</div>

							<button class="tui-btn tui-btn-success" onclick={handleCreateFederationToken} style="width: 100%;">
								[ + GENERATE & SIGN TOKEN ]
							</button>
						</div>
					{/if}

					<!-- Join Remote ZGALAXY Node Form -->
					{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
						<div style="background: #08080c; border: 1px solid var(--border-color); padding: 12px;">
							<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 8px;">[ JOIN REMOTE FEDERATION NODE ]</div>
							<div style="margin-bottom: 8px;">
								<label for="joinTargetEndpointInput">[ TARGET ENDPOINT URL ]</label>
								<input id="joinTargetEndpointInput" type="text" class="tui-input" bind:value={joinTargetEndpoint} placeholder="http://192.168.1.181:3000" style="margin-top: 4px;" />
							</div>

							<div style="margin-bottom: 8px;">
								<label for="joinTokenSecretInput">[ FEDERATION TOKEN SECRET ]</label>
								<input id="joinTokenSecretInput" type="password" class="tui-input" bind:value={joinTokenSecret} placeholder="zgt_fed_sec_..." style="margin-top: 4px;" />
							</div>

							<div style="margin-bottom: 12px;">
								<label for="joinRequestedModeSelect">[ REQUESTED SYNC MODE ]</label>
								<select id="joinRequestedModeSelect" class="tui-input" bind:value={joinRequestedMode} style="margin-top: 4px;">
									<option value="FEDERATION_INHERITED">FEDERATION_INHERITED (Inherit & Discover Mesh)</option>
									<option value="DIRECT_ISOLATED">DIRECT_ISOLATED (Isolate 2 Nodes Only)</option>
								</select>
							</div>

							<button class="tui-btn tui-btn-success" onclick={handleJoinFederation} style="width: 100%;">
								[ CONNECT & HANDSHAKE PEER ]
							</button>
						</div>
					{/if}
				</div>

				<!-- Generated Federation Tokens Table -->
				<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px;">[ ACTIVE & MANAGED FEDERATION TOKENS ]</div>
				{#if fedTokensList.length === 0}
					<div style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">No Federation Tokens generated yet.</div>
				{:else}
					<div style="margin-bottom: 16px; max-height: 180px; overflow-y: auto;">
						<table class="tui-table">
							<thead>
								<tr>
									<th>TOKEN ID</th>
									<th>NAME</th>
									<th>MODE</th>
									<th>USES</th>
									<th>EXPIRES AT</th>
									<th>STATUS</th>
									<th>ACTIONS</th>
								</tr>
							</thead>
							<tbody>
								{#each fedTokensList as tok}
									<tr>
										<td style="color: var(--accent-gold); font-weight: bold;">{tok.tokenId}</td>
										<td>{tok.name}</td>
										<td>
											<span class="tui-badge {tok.syncMode === 'FEDERATION_INHERITED' ? 'tui-badge-ok' : 'tui-badge-warn'}">
												{tok.syncMode === 'FEDERATION_INHERITED' ? '[ INHERITED MESH ]' : '[ DIRECT ISOLATED ]'}
											</span>
										</td>
										<td>{tok.usedCount} / {tok.maxUses}</td>
										<td style="font-size: 11px;">{tok.expiresAt.substring(0, 10)}</td>
										<td>
											<span class="tui-badge {tok.status === 'ACTIVE' ? 'tui-badge-ok' : tok.status === 'EXPIRED' ? 'tui-badge-warn' : 'tui-badge-error'}">
												[{tok.status}]
											</span>
										</td>
										<td>
											<div style="display: flex; gap: 4px;">
												<button class="tui-btn" onclick={() => showCustomAlert('[ TOKEN SECRET ]', tok.tokenSecret)} style="padding: 2px 6px; font-size: 11px;">[ VIEW SECRET ]</button>
												{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
													{#if tok.status === 'ACTIVE'}
														<button class="tui-btn tui-btn-danger" onclick={() => handleRevokeFederationToken(tok.tokenId)} style="padding: 2px 6px; font-size: 11px;">[ REVOKE ]</button>
													{:else}
														<button class="tui-btn tui-btn-success" onclick={() => handleRenewFederationToken(tok.tokenId)} style="padding: 2px 6px; font-size: 11px;">[ RENEW 30D ]</button>
													{/if}
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				<!-- Federation Mesh Peers Topology Table -->
				<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px;">[ FEDERATION MESH PEERS & TOPOLOGY MAP ]</div>
				{#if fedPeersList.length === 0}
					<div style="color: var(--text-muted); font-size: 13px;">No active peers joined to local node.</div>
				{:else}
					<table class="tui-table">
						<thead>
							<tr>
								<th>NODE ID</th>
								<th>NAME</th>
								<th>ENDPOINT</th>
								<th>SYNC MODE</th>
								<th>TRANSITIVITY</th>
								<th>DISCOVERED VIA</th>
								<th>STATUS</th>
								<th>ACTIONS</th>
							</tr>
						</thead>
						<tbody>
							{#each fedPeersList as peer}
								<tr>
									<td style="color: var(--accent-gold); font-weight: bold;">{peer.nodeId}</td>
									<td>{peer.nodeName}</td>
									<td>{peer.endpoint}</td>
									<td>
										<span class="tui-badge {peer.syncMode === 'FEDERATION_INHERITED' ? 'tui-badge-ok' : 'tui-badge-warn'}">
											{peer.syncMode === 'FEDERATION_INHERITED' ? '[ INHERITED MESH ]' : '[ DIRECT ISOLATED ]'}
										</span>
									</td>
									<td>
										<span class="tui-badge {peer.connectionType === 'TRANSITIVE' ? 'tui-badge-ok' : 'tui-badge-error'}">
											{peer.connectionType === 'TRANSITIVE' ? '[ TRANSITIVE (FULL MESH) ]' : '[ ISOLATED (P2P ONLY) ]'}
										</span>
									</td>
									<td style="font-size: 11px;">{peer.discoveredVia}</td>
									<td>
										<span class="tui-badge {peer.status === 'ONLINE' ? 'tui-badge-ok' : 'tui-badge-error'}">
											[{peer.status}]
										</span>
									</td>
									<td>
										{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
											<button class="tui-btn tui-btn-danger" onclick={() => handleDisconnectPeer(peer.nodeId)} style="padding: 2px 6px; font-size: 11px;">
												[ DISCONNECT ]
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>

		<!-- MULTI-PLANET CLUSTER FEDERATION PANEL -->
		<div class="tui-box">
			<div class="tui-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
				<div>┌── [ MULTI-PLANET CLUSTER FEDERATION & HIGH AVAILABILITY ]</div>
				<div>
					<span style="color: var(--text-muted); font-size: 12px; margin-right: 8px;">FEDERATED ROOTS:</span>
					<span class="tui-badge tui-badge-ok">
						[{clusterNodesList.length} ACTIVE NODES]
					</span>
				</div>
			</div>
			<div class="tui-body">
				<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
					<button class="tui-btn tui-btn-success" onclick={handleSyncClusterNodes}>[ SYNC CLUSTER NODES ]</button>
					<button class="tui-btn tui-btn-success" onclick={handleBuildUnifiedClusterPlanet}>[ COMPILE UNIFIED HA PLANET BINARY ]</button>
					<button class="tui-btn" onclick={fetchClusterTopology}>[ REFRESH TOPOLOGY ]</button>
				</div>

				<!-- Register New Planet Node Form -->
				{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
					<div style="background: #08080c; border: 1px solid var(--border-color); padding: 12px; margin-bottom: 16px;">
						<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 8px;">[ REGISTER REMOTE PLANET NODE TO FEDERATION ]</div>
						<div class="grid-2" style="margin-bottom: 8px;">
							<div>
								<label for="newClusterNodeIdInput">[ PLANET NODE ID ]</label>
								<input id="newClusterNodeIdInput" type="text" class="tui-input" bind:value={newClusterNodeId} placeholder="e.g. planet_beta_181" style="margin-top: 4px;" />
							</div>
							<div>
								<label for="newClusterNodeNameInput">[ NODE NAME / LABEL ]</label>
								<input id="newClusterNodeNameInput" type="text" class="tui-input" bind:value={newClusterNodeName} placeholder="e.g. Planet Beta (Server 181)" style="margin-top: 4px;" />
							</div>
						</div>
						<div class="grid-2" style="margin-bottom: 12px;">
							<div>
								<label for="newClusterNodeIp4Input">[ IPv4 ADDRESS ]</label>
								<input id="newClusterNodeIp4Input" type="text" class="tui-input" bind:value={newClusterNodeIp4} placeholder="e.g. 192.168.1.181" style="margin-top: 4px;" />
							</div>
							<div>
								<label for="newClusterNodeDomainInput">[ DOMAIN NAME (OPTIONAL) ]</label>
								<input id="newClusterNodeDomainInput" type="text" class="tui-input" bind:value={newClusterNodeDomain} placeholder="e.g. planet-beta.dreamzone.cc" style="margin-top: 4px;" />
							</div>
						</div>
						<button class="tui-btn tui-btn-success" onclick={handleAddClusterNode}>
							[ + REGISTER PLANET NODE ]
						</button>
					</div>
				{/if}

				<!-- Federated Nodes Table -->
				<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px;">[ FEDERATED PLANET CLUSTER NODES ]</div>
				{#if clusterNodesList.length === 0}
					<div style="color: var(--text-muted); font-size: 13px;">No federated cluster nodes registered.</div>
				{:else}
					<table class="tui-table">
						<thead>
							<tr>
								<th>NODE ID</th>
								<th>NAME</th>
								<th>IPv4</th>
								<th>DOMAIN</th>
								<th>PORT</th>
								<th>TYPE</th>
								<th>STATUS</th>
								<th>LAST SYNCED</th>
								<th>ACTIONS</th>
							</tr>
						</thead>
						<tbody>
							{#each clusterNodesList as node}
								<tr>
									<td style="color: var(--accent-gold); font-weight: bold;">{node.nodeId}</td>
									<td>{node.name}</td>
									<td>{node.ip4}</td>
									<td>{node.domain || 'N/A'}</td>
									<td>{node.port}</td>
									<td>
										<span class="tui-badge {node.isLocal ? 'tui-badge-ok' : 'tui-badge-warn'}">
											{node.isLocal ? '[ LOCAL PRIMARY ]' : '[ FEDERATED REMOTE ]'}
										</span>
									</td>
									<td>
										<span class="tui-badge {node.status === 'ONLINE' ? 'tui-badge-ok' : 'tui-badge-error'}">
											[{node.status}]
										</span>
									</td>
									<td style="font-size: 11px;">{node.lastSyncedAt ? node.lastSyncedAt.substring(0, 19).replace('T', ' ') : 'N/A'}</td>
									<td>
										{#if !node.isLocal && (currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR')}
											<button class="tui-btn tui-btn-danger" onclick={() => handleRemoveClusterNode(node.nodeId)} style="padding: 2px 6px; font-size: 11px;">
												[ REMOVE ]
											</button>
										{:else}
											<span style="color: var(--text-muted); font-size: 11px;">[ PRIMARY ]</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>

		<!-- Cloudflare DNS Auto-Sync & Domain Management Panel -->
		<div class="tui-box">
			<div class="tui-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
				<div>┌── [ CLOUDFLARE DNS AUTO-SYNC & DOMAIN MANAGEMENT ]</div>
				<div>
					<span style="color: var(--text-muted); font-size: 12px; margin-right: 8px;">STATUS:</span>
					<span class="tui-badge {cfEnabled ? 'tui-badge-ok' : 'tui-badge-warn'}">
						{cfEnabled ? '[ AUTO-SYNC ENABLED ]' : '[ DISABLED ]'}
					</span>
				</div>
			</div>
			<div class="tui-body">
				<div class="grid-2" style="margin-bottom: 14px;">
					<div>
						<label for="cfApiTokenInput" style="color: var(--accent-gold);">[ CLOUDFLARE API TOKEN ]</label>
						<div style="display: flex; gap: 6px; margin-top: 4px;">
							<input id="cfApiTokenInput" type="password" class="tui-input" bind:value={cfApiToken} placeholder={cfHasToken ? `CONFIGURED (${cfApiTokenMasked})` : 'Enter Cloudflare API Token...'} />
							<button class="tui-btn" onclick={handleVerifyCloudflareToken}>[ VERIFY TOKEN ]</button>
						</div>
					</div>
					<div>
						<label for="cfModeSelect" style="color: var(--accent-gold);">[ CONFIGURATION MODE ]</label>
						<select id="cfModeSelect" class="tui-input" bind:value={cfMode} style="margin-top: 4px;">
							<option value="MANUAL">MANUAL CONFIGURATION (Direct Input)</option>
							<option value="AUTOMATIC">AUTOMATIC RETRIEVAL (Fetch from Cloudflare Account)</option>
						</select>
					</div>
				</div>

				{#if cfMode === 'AUTOMATIC'}
					<div class="grid-2" style="margin-bottom: 14px; background: #08080c; padding: 12px; border: 1px solid var(--border-color);">
						<div>
							<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
								<label for="cfZoneSelect">[ SELECT CLOUDFLARE ZONE (DOMAIN) ]</label>
								<button class="tui-btn" onclick={handleFetchCloudflareZones} style="padding: 2px 6px; font-size: 11px;">[ FETCH ZONES ]</button>
							</div>
							<select id="cfZoneSelect" class="tui-input" value={cfZoneId} onchange={(e) => handleZoneSelect((e.target as HTMLSelectElement).value)}>
								<option value="">-- Choose Zone / Domain --</option>
								{#each cfZonesList as zone}
									<option value={zone.id}>{zone.name} [{zone.status}]</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="cfRecordSelect">[ SELECT DNS RECORD (SUBDOMAIN) ]</label>
							<select id="cfRecordSelect" class="tui-input" value={cfRecordId} onchange={(e) => handleRecordSelect((e.target as HTMLSelectElement).value)} style="margin-top: 4px;">
								<option value="">-- Choose Record / Subdomain --</option>
								{#each cfRecordsList as rec}
									<option value={rec.id}>{rec.name} ({rec.type}) -> {rec.content}</option>
								{/each}
							</select>
						</div>
					</div>
				{/if}

				<div class="grid-2" style="margin-bottom: 14px;">
					<div>
						<label for="cfZoneNameInput">[ ZONE NAME / DOMAIN ]</label>
						<input id="cfZoneNameInput" type="text" class="tui-input" bind:value={cfZoneName} placeholder="e.g. mycompany.com" style="margin-top: 4px;" />
					</div>
					<div>
						<label for="cfRecordNameInput">[ RECORD NAME / SUBDOMAIN ]</label>
						<input id="cfRecordNameInput" type="text" class="tui-input" bind:value={cfRecordName} placeholder="e.g. planet or planet.mycompany.com" style="margin-top: 4px;" />
					</div>
				</div>

				<div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 16px; font-size: 13px;">
					<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
						<input type="checkbox" bind:checked={cfEnabled} />
						<span style="color: var(--accent-gold);">[ ENABLE AUTOMATIC CLOUDFLARE SYNC ]</span>
					</label>

					<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
						<input type="checkbox" bind:checked={cfProxied} />
						<span>[ CLOUDFLARE PROXY (ORANGE CLOUD) ]</span>
					</label>

					<label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
						<input type="checkbox" bind:checked={cfAutoRebuildPlanet} />
						<span>[ AUTO-REBUILD PLANET ON IP CHANGE ]</span>
					</label>
				</div>

				{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
					<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
						<button class="tui-btn tui-btn-success" onclick={handleSaveCloudflareConfig}>[ SAVE CLOUDFLARE CONFIG ]</button>
						<button class="tui-btn" onclick={handleForceCloudflareSync}>[ FORCE SYNC CLOUDFLARE DNS NOW ]</button>
						<button class="tui-btn" onclick={fetchCloudflareLogs}>[ REFRESH LOGS ]</button>
						<button class="tui-btn tui-btn-danger" onclick={handleClearCloudflareLogs}>[ CLEAR SYNC LOGS ]</button>
					</div>
				{/if}

				{#if cfLastSyncedIp}
					<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
						LAST SYNCED IP: <span style="color: var(--accent-gold);">{cfLastSyncedIp}</span> | TIMESTAMP: {cfLastSyncedAt}
					</div>
				{/if}

				<!-- Cloudflare Sync Logs Table -->
				<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
					<div>[ CLOUDFLARE SYNC HISTORY LOGS ]</div>
					{#if cfSyncLogsList.length > 0 && (currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR')}
						<button class="tui-btn tui-btn-danger" onclick={handleClearCloudflareLogs} style="padding: 2px 6px; font-size: 11px;">[ CLEAR LOGS ]</button>
					{/if}
				</div>
				{#if cfSyncLogsList.length === 0}
					<div style="color: var(--text-muted); font-size: 13px;">No Cloudflare sync logs available.</div>
				{:else}
					<div style="max-height: 160px; overflow-y: auto;">
						<table class="tui-table">
							<thead>
								<tr>
									<th>TIMESTAMP</th>
									<th>STATUS</th>
									<th>DOMAIN</th>
									<th>IP ADDRESS</th>
									<th>LOG MESSAGE</th>
								</tr>
							</thead>
							<tbody>
								{#each cfSyncLogsList as logItem}
									<tr>
										<td>{logItem.timestamp.substring(0, 19).replace('T', ' ')}</td>
										<td>
											<span class="tui-badge {logItem.status === 'SUCCESS' ? 'tui-badge-ok' : logItem.status === 'ERROR' ? 'tui-badge-error' : 'tui-badge-warn'}">
												[{logItem.status}]
											</span>
										</td>
										<td style="color: var(--accent-gold);">{logItem.domain}</td>
										<td>{logItem.ipAddress || 'N/A'}</td>
										<td style="font-size: 11px;">{logItem.message}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>

		<!-- Member & Permission Management Panel (Admin Only) -->
		{#if currentUserRole === 'ADMIN'}
			<div class="tui-box">
				<div class="tui-header">┌── [ MEMBER & PERMISSION MANAGEMENT (ADMIN CONTROL) ]</div>
				<div class="tui-body">
					<div class="grid-2" style="margin-bottom: 14px;">
						<div>
							<label for="newMemberUsernameInput">[ MEMBER USERNAME ]</label>
							<input id="newMemberUsernameInput" type="text" class="tui-input" bind:value={newMemberUsername} placeholder="e.g. operator1" style="margin-top: 4px;" />
						</div>
						<div>
							<label for="newMemberPasswordInput">[ MEMBER PASSWORD ]</label>
							<input id="newMemberPasswordInput" type="password" class="tui-input" bind:value={newMemberPassword} placeholder="••••••••" style="margin-top: 4px;" />
						</div>
					</div>

					<div style="margin-bottom: 14px;">
						<label for="newMemberRoleSelect">[ PERMISSION ROLE ]</label>
						<select id="newMemberRoleSelect" class="tui-input" bind:value={newMemberRole} style="margin-top: 4px;">
							<option value="ADMIN">ADMIN (Full System & Member Control)</option>
							<option value="OPERATOR">OPERATOR (Build & Operations Only)</option>
							<option value="READ_ONLY">READ_ONLY (View & Download Only)</option>
						</select>
					</div>

					<button class="tui-btn tui-btn-success" onclick={handleCreateMember} style="margin-bottom: 16px;">
						[ + REGISTER NEW MEMBER ]
					</button>

					<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px;">[ REGISTERED MEMBERS & ROLES ]</div>
					{#if membersList.length === 0}
						<div style="color: var(--text-muted); font-size: 13px;">No members found.</div>
					{:else}
						<table class="tui-table">
							<thead>
								<tr>
									<th>USERNAME</th>
									<th>ROLE</th>
									<th>CREATED AT</th>
									<th>LAST LOGIN</th>
									<th>ACTIONS</th>
								</tr>
							</thead>
							<tbody>
								{#each membersList as member}
									<tr>
										<td style="color: var(--accent-gold);">{member.username}</td>
										<td><span class="tui-badge tui-badge-ok">{member.role}</span></td>
										<td>{member.createdAt.substring(0, 10)}</td>
										<td>{member.lastLoginAt ? member.lastLoginAt.substring(0, 19).replace('T', ' ') : 'NEVER'}</td>
										<td>
											{#if member.username !== 'admin'}
												<button class="tui-btn tui-btn-danger" onclick={() => handleDeleteMember(member.username)} style="padding: 2px 6px; font-size: 11px;">[ DELETE ]</button>
											{:else}
												<span style="color: var(--text-muted); font-size: 11px;">[ MASTER ]</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Network Inspector & Domain Management Panel -->
		<div class="tui-box">
			<div class="tui-header">┌── [ NETWORK ADDRESSES INSPECTOR & DOMAIN BINDING ]</div>
			<div class="tui-body">
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
					<div style="color: var(--text-muted); font-size: 13px;">
						Internal (LAN) & External (WAN) network addresses detected by ZGalaxy Engine.
					</div>
					<button class="tui-btn tui-btn-success" onclick={autoDetectAddresses}>[ AUTO-DETECT ADDRESSES ]</button>
				</div>

				<div class="grid-2" style="margin-bottom: 12px;">
					<div>
						<label for="internalIp4Input">[ INTERNAL IPv4 ADDRESS (LAN) ]</label>
						<input id="internalIp4Input" type="text" class="tui-input" bind:value={internalIp4} placeholder="e.g. 192.168.1.100" />
					</div>
					<div>
						<label for="internalIp6Input">[ INTERNAL IPv6 ADDRESS (LAN) ]</label>
						<input id="internalIp6Input" type="text" class="tui-input" bind:value={internalIp6} placeholder="e.g. fe80::1" />
					</div>
				</div>

				<div class="grid-2" style="margin-bottom: 16px;">
					<div>
						<label for="externalIp4Input">[ EXTERNAL PUBLIC IPv4 ADDRESS (WAN) ]</label>
						<input id="externalIp4Input" type="text" class="tui-input" bind:value={externalIp4} placeholder="e.g. 203.0.113.10" />
					</div>
					<div>
						<label for="externalIp6Input">[ EXTERNAL PUBLIC IPv6 ADDRESS (WAN) ]</label>
						<input id="externalIp6Input" type="text" class="tui-input" bind:value={externalIp6} placeholder="e.g. 2001:db8::10" />
					</div>
				</div>

				<hr style="border-color: var(--border-color); margin: 16px 0;" />

				<div style="margin-bottom: 10px;">
					<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
						<label for="domainNameInput" style="color: var(--accent-gold);">[ DOMAIN NAME / FQDN BINDING (DYNAMIC IP / DDNS) ]</label>
						<span style="font-size: 12px; color: var(--accent-yellow);">{domainStatus}</span>
					</div>
					<input id="domainNameInput" type="text" class="tui-input" bind:value={domainName} placeholder="e.g. brg-dz.dreamzone.cc" style="margin-top: 4px;" />
				</div>

				<div style="display: flex; gap: 8px; flex-wrap: wrap;">
					<button class="tui-btn" onclick={handleVerifyDomain}>[ VERIFY DNS RESOLUTION ]</button>
					{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
						<button class="tui-btn tui-btn-success" onclick={handleBindDomain}>[ BIND DOMAIN TO PLANET ]</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Dynamic IP (DDNS) Auto-Sync Engine -->
		<div class="tui-box">
			<div class="tui-header">┌── [ DYNAMIC IP & AUTOMATIC DDNS SYNC ENGINE ]</div>
			<div class="tui-body">
				{#if ddnsConfig}
					<div style="margin-bottom: 12px; font-size: 13px;">
						<div>AUTO-SYNC WORKER: <span class="tui-badge tui-badge-ok">{ddnsConfig.enabled ? '[ ENABLED - EVERY 5 MINS ]' : '[ DISABLED ]'}</span></div>
						<div>TRACKED DOMAIN  : <span style="color: var(--accent-gold);">{ddnsConfig.domain || 'NONE BOUND'}</span></div>
						<div>RESOLVED IPv4   : <span style="color: var(--accent-gold);">{ddnsConfig.lastResolvedIp4 || 'N/A'}</span></div>
						<div>LAST CHECKED    : {ddnsConfig.lastCheckedAt}</div>
					</div>
				{/if}
				{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
					<div style="display: flex; gap: 8px; flex-wrap: wrap;">
						<button class="tui-btn tui-btn-success" onclick={handleForceDDNSSync}>[ FORCE DDNS SYNC & REBUILD NOW ]</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Main Grid: Planet & Moon -->
		<div class="grid-2">
			<!-- Planet Management Panel -->
			<div class="tui-box">
				<div class="tui-header">┌── [ PLANET MANAGEMENT & CONFIGURATION ]</div>
				<div class="tui-body">
					{#if planetInfo}
						<div style="margin-bottom: 12px; font-size: 13px;">
							<div>STATUS : <span class="tui-badge tui-badge-ok">{planetInfo.status}</span></div>
							<div>PATH   : {planetInfo.planetPath || 'NOT CREATED'}</div>
							<div>DOMAIN : {planetInfo.domain || 'NONE'}</div>
							<div>IP4    : {planetInfo.ip4 || 'N/A'}</div>
							<div>PORT   : {planetInfo.port}</div>
						</div>
					{/if}

					<div style="margin-bottom: 14px;">
						<label for="planetPortInput">[ ZEROTIER PORT ]</label>
						<input id="planetPortInput" type="number" class="tui-input" bind:value={planetPort} />
					</div>

					<div style="display: flex; gap: 8px; flex-wrap: wrap;">
						{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
							<button class="tui-btn tui-btn-success" onclick={handleBuildPlanet}>[ BUILD / REGENERATE PLANET ]</button>
						{/if}
						<a class="tui-btn" href="{apiUrl}/api/v1/planet/download" target="_blank">[ DOWNLOAD PLANET BINARY ]</a>
						<button class="tui-btn" onclick={handleValidatePlanet}>[ VALIDATE SIGNATURE ]</button>
					</div>
				</div>
			</div>

			<!-- Moon Management & Migration Panel -->
			<div class="tui-box">
				<div class="tui-header">┌── [ MOON LIFECYCLE & MIGRATION MANAGEMENT ]</div>
				<div class="tui-body">
					{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
						<div style="margin-bottom: 10px;">
							<label for="moonNameInput">[ MOON NODE NAME ]</label>
							<input id="moonNameInput" type="text" class="tui-input" bind:value={moonName} />
						</div>
						<div style="margin-bottom: 14px;">
							<label for="moonEndpointsInput">[ ENDPOINTS (IP OR DOMAIN:PORT) ]</label>
							<input id="moonEndpointsInput" type="text" class="tui-input" bind:value={moonEndpoints} placeholder="10.0.0.1/9993, moon.mycompany.com/9993" />
						</div>
						<button class="tui-btn tui-btn-success" onclick={handleCreateMoon} style="margin-bottom: 16px;">[ + GENERATE NEW MOON ]</button>
					{/if}

					<!-- Moon Migration Controls Form -->
					{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
						<div style="background: #08080c; border: 1px solid var(--border-color); padding: 10px; margin-bottom: 14px;">
							<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px;">[ MOON MIGRATION & RE-BINDING PARAMS ]</div>
							<div class="grid-2" style="margin-bottom: 6px;">
								<div>
									<label for="targetPlanetIdInput">[ TARGET PLANET NODE ID ]</label>
									<input id="targetPlanetIdInput" type="text" class="tui-input" bind:value={targetPlanetNodeId} placeholder="e.g. planet_beta_181" style="margin-top: 4px;" />
								</div>
								<div>
									<label for="rebindEndpointsInput">[ RE-BIND ENDPOINTS (CSV) ]</label>
									<input id="rebindEndpointsInput" type="text" class="tui-input" bind:value={rebindEndpointsInput} placeholder="e.g. planet-beta.dreamzone.cc/9994" style="margin-top: 4px;" />
								</div>
							</div>
						</div>
					{/if}

					<div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 6px;">[ ACTIVE MOON NODES ]</div>
					{#if moonsList.length === 0}
						<div style="color: var(--text-muted); font-size: 13px;">No Moon nodes found.</div>
					{:else}
						<table class="tui-table">
							<thead>
								<tr>
									<th>FILE NAME</th>
									<th>ACTIONS</th>
								</tr>
							</thead>
							<tbody>
								{#each moonsList as moon}
									<tr>
										<td>{moon.fileName}</td>
										<td>
											<div style="display: flex; gap: 4px; flex-wrap: wrap;">
												<a class="tui-btn" href="{apiUrl}{moon.downloadUrl}" target="_blank" style="padding: 2px 6px; font-size: 11px;">[ DOWNLOAD .MOON ]</a>
												{#if currentUserRole === 'ADMIN' || currentUserRole === 'OPERATOR'}
													<button class="tui-btn tui-btn-success" onclick={() => handleMigrateMoon(moon.id)} style="padding: 2px 6px; font-size: 11px;">[ MIGRATE MOON ]</button>
													<button class="tui-btn" onclick={() => handleRebindMoon(moon.id)} style="padding: 2px 6px; font-size: 11px;">[ RE-BIND ]</button>
													<button class="tui-btn tui-btn-danger" onclick={() => handleDeleteMoon(moon.fileName)} style="padding: 2px 6px; font-size: 11px;">[ DELETE ]</button>
												{/if}
											</div>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>
		</div>

		<!-- Secondary Grid: Identity & Backup -->
		<div class="grid-2">
			<!-- Identity Panel -->
			<div class="tui-box">
				<div class="tui-header">┌── [ IDENTITY & CERTIFICATE MANAGEMENT ]</div>
				<div class="tui-body">
					{#if identityInfo}
						<div style="margin-bottom: 12px; font-size: 13px;">
							<div>NODE ADDRESS  : <span style="color: var(--accent-gold);">{identityInfo.nodeAddress || 'N/A'}</span></div>
							<div>PUBLIC KEY    : {identityInfo.publicIdentityExists ? '[ PRESENT ]' : '[ MISSING ]'}</div>
							<div>SECRET KEY    : {identityInfo.secretIdentityExists ? '[ PRESENT ]' : '[ MISSING ]'}</div>
							<div>KEY STRENGTH  : {identityInfo.keyStrength}</div>
						</div>
					{/if}

					<div style="display: flex; gap: 8px; flex-wrap: wrap;">
						<button class="tui-btn" onclick={handleVerifyIdentity}>[ VERIFY INTEGRITY ]</button>
						{#if currentUserRole === 'ADMIN'}
							<button class="tui-btn tui-btn-danger" onclick={handleRotateKeys}>[ ROTATE KEYS & CERTS ]</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- Backup & Disaster Recovery Panel -->
			<div class="tui-box">
				<div class="tui-header">┌── [ BACKUP & DISASTER RECOVERY ]</div>
				<div class="tui-body">
					<p style="color: var(--text-muted); margin-bottom: 12px; font-size: 13px;">
						Export or restore full encrypted archives containing world.bin, moon configs, keys, and tokens.
					</p>
					{#if currentUserRole === 'ADMIN'}
						<div style="display: flex; gap: 8px; flex-wrap: wrap;">
							<button class="tui-btn tui-btn-success" onclick={handleExportBackup}>[ EXPORT FULL BACKUP ARCHIVE ]</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Console Output Box -->
		<div class="tui-box">
			<div class="tui-header">┌── [ ZGALAXY TERMINAL CONSOLE LOG / API OUTPUT ]</div>
			<div class="tui-body" style="background: #05080c; max-height: 200px; overflow-y: auto;">
				{#each logs as log}
					<div style="font-size: 12px; color: var(--accent-gold); font-family: var(--font-mono); white-space: pre-wrap;">
						{log}
					</div>
				{/each}
			</div>
		</div>

		<!-- Project Metadata Footer Box -->
		<div class="tui-box" style="margin-top: 16px;">
			<div class="tui-header">┌── [ ZGALAXY PLATFORM METADATA & LICENSE ]</div>
			<div class="tui-body" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 12px;">
				<div>
					PROJECT: <span style="color: var(--accent-gold); font-weight: bold;">ZGALAXY</span> |
					LICENSE: <span class="tui-badge tui-badge-ok">AGPL-3.0</span>
				</div>
				<div>
					DEVELOPER DISCORD: <span style="color: var(--accent-gold);">yuuyu_gg</span> |
					GITHUB: <a href="https://github.com/dreamzone-cc" target="_blank" style="color: var(--accent-gold); text-decoration: underline;">https://github.com/dreamzone-cc</a>
				</div>
			</div>
		</div>
	{/if}
</main>
