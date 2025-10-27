// --- MANEJO DE LA REDIRECCIÓN DE AUTENTICACIÓN ---
// Esta función se ejecuta inmediatamente para capturar el token de la URL
(function handleAuthRedirect() {
    // Si estamos en la página de la app y hay un hash en la URL
    if (window.location.pathname.includes('app.html') && window.location.hash) {
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const expiresIn = params.get('expires_in');

        if (accessToken && expiresIn) {
            const expiresAt = new Date().getTime() + parseInt(expiresIn) * 1000;
            localStorage.setItem('spotify_access_token', accessToken);
            localStorage.setItem('spotify_token_expires_at', expiresAt.toString());
            // Limpia el hash de la URL para que no quede visible
            window.history.replaceState(null, null, 'app.html');
        }
    }
})();


document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DEL DOM ---
    const contentArea = document.getElementById('content-area');
    const folderListEl = document.getElementById('folder-list');
    const searchForm = document.getElementById('search-form');
    const searchQueryInput = document.getElementById('search-query');
    const searchTypeSelect = document.getElementById('search-type');
    const searchButton = document.getElementById('search-button');
    const createFolderForm = document.getElementById('create-folder-form');
    const newFolderNameInput = document.getElementById('new-folder-name');
    const logoutButton = document.getElementById('logout-button');
    
    // Modal de añadir a carpeta
    const modal = document.getElementById('add-to-folder-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalFolderList = document.getElementById('modal-folder-list');
    const modalCloseButton = document.getElementById('modal-close-button');

    // Modal de editar canción
    const editModal = document.getElementById('edit-song-modal');
    const editForm = document.getElementById('edit-song-form');
    const editCancelButton = document.getElementById('edit-modal-cancel-button');
    const editSongIdInput = document.getElementById('edit-song-id');
    const editFolderIdInput = document.getElementById('edit-folder-id');
    const editSongTitleInput = document.getElementById('edit-song-title');
    const editSongArtistInput = document.getElementById('edit-song-artist');
    const editSongAlbumInput = document.getElementById('edit-song-album');
    const editSongKeyInput = document.getElementById('edit-song-key');


    // --- ESTADO DE LA APLICACIÓN ---
    let accessToken = null;
    let folders = [];
    let songsByFolder = {};
    let selectedFolderId = null;
    let songToAdd = null;
    const FOLDER_SONG_LIMIT = 60;
    const initialFolders = [
        { id: 'bpm-85-105', name: 'Slow', bpmRange: '85-105 BPM' },
        { id: 'bpm-105-120', name: 'Medium', bpmRange: '105-120 BPM' },
        { id: 'bpm-120-135', name: 'Fast', bpmRange: '120-135 BPM' },
        { id: 'bpm-135-148', name: 'Very Fast', bpmRange: '135-148 BPM' },
        { id: 'bpm-148-plus', name: 'Extreme', bpmRange: '148+ BPM' },
    ];
    
    // --- HELPERS ---
    function convertPitchClassToKey(pitchClass, mode) {
        if (pitchClass === -1) return 'N/A';
        const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const key = keys[pitchClass];
        const modeStr = mode === 1 ? 'Major' : 'Minor';
        return `${key} ${modeStr}`;
    }


    // --- FUNCIONES DE LA API DE SPOTIFY ---
    async function spotifyApiFetch(endpoint) {
        const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        if (response.status === 401) { // Token expirado
            logout();
            return null;
        }
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Error en la API de Spotify: ${error.error.message || response.statusText}`);
        }
        return response.json();
    }

    async function searchTracks(query) {
        const data = await spotifyApiFetch(`search?q=${encodeURIComponent(query)}&type=track&limit=15`);
        if (!data || !data.tracks || !data.tracks.items) return [];

        const trackIds = data.tracks.items.map(track => track.id).filter(Boolean).join(',');
        if (!trackIds) return [];

        const featuresData = await spotifyApiFetch(`audio-features?ids=${trackIds}`);
        if (!featuresData) return []; // Salir si la llamada a features falla

        return data.tracks.items.map(track => {
            const features = featuresData.audio_features.find(f => f && f.id === track.id);
            return {
                id: track.id,
                title: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                album: track.album.name,
                year: track.album.release_date.substring(0, 4),
                bpm: features ? Math.round(features.tempo) : 0,
                key: features ? convertPitchClassToKey(features.key, features.mode) : 'N/A',
                coverArt: track.album.images.length ? track.album.images[0].url : 'https://via.placeholder.com/128',
            };
        });
    }

    // --- FUNCIONES DE RENDERIZADO ---
    function renderFolders() {
        folderListEl.innerHTML = '';
        folders.forEach(folder => {
            const songCount = songsByFolder[folder.id]?.length || 0;
            const isCustom = folder.id.startsWith('custom-');
            const folderCard = document.createElement('div');
            folderCard.className = `folder-card relative group cursor-pointer p-3 rounded-lg transition-all ${selectedFolderId === folder.id ? 'bg-green-600/80 ring-2 ring-green-400' : 'bg-gray-800 hover:bg-gray-700'}`;
            folderCard.dataset.folderId = folder.id;
            
            folderCard.innerHTML = `
                <div class="flex items-center mb-1">
                    <span class="material-icons text-green-400 mr-2">folder</span>
                    <h3 class="font-bold text-white truncate text-sm">${folder.name}</h3>
                </div>
                ${folder.bpmRange ? `<p class="text-xs text-gray-400 mb-2 ml-8">${folder.bpmRange}</p>` : ''}
                <div class="text-xs text-gray-400 bg-gray-900/50 rounded-full px-2 py-0.5 inline-block mt-1 ml-8">
                    ${songCount} / ${FOLDER_SONG_LIMIT}
                </div>
                ${isCustom ? `
                <button data-delete-id="${folder.id}" data-delete-name="${folder.name}" class="folder-delete-btn absolute top-1 right-1 p-1 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Borrar ${folder.name}">
                    <span class="material-icons" style="font-size: 16px;">close</span>
                </button>
                ` : ''}
            `;
            folderListEl.appendChild(folderCard);
        });
    }

    function createSongCard(song, actionButtonHtml) {
        return `
            <div class="bg-gray-800 rounded-lg p-4 flex items-center gap-4 transition-all hover:bg-gray-700/50">
                <img src="${song.coverArt}" alt="${song.album}" class="w-16 h-16 rounded-md object-cover flex-shrink-0">
                <div class="flex-grow min-w-0">
                    <p class="font-bold text-white truncate">${song.title}</p>
                    <p class="text-sm text-gray-400 truncate">${song.artist}</p>
                    <p class="text-xs text-gray-500 truncate">${song.album} (${song.year})</p>
                </div>
                <div class="text-center w-20">
                     <p class="text-2xl font-bold text-green-400">${song.bpm}</p>
                    <p class="text-xs text-gray-500">BPM</p>
                </div>
                <div class="text-center w-24">
                    <p class="text-lg font-semibold text-cyan-400">${song.key}</p>
                    <p class="text-xs text-gray-500">Key</p>
                </div>
                <div class="ml-auto flex flex-col space-y-2">${actionButtonHtml}</div>
            </div>
        `;
    }

    function renderSearchResults(songs) {
        selectedFolderId = null;
        contentArea.innerHTML = `
            <div class="p-4 bg-gray-800/50 rounded-lg">
                <h2 class="text-2xl font-bold mb-4">Resultados de Búsqueda</h2>
                <div class="space-y-3">
                    ${songs.length > 0 ? songs.map(song => createSongCard(song, `
                        <button data-song='${JSON.stringify(song)}' class="add-song-btn p-2 text-gray-300 hover:text-white rounded-full bg-green-700 hover:bg-green-600 transition" title="Añadir a carpeta">
                           <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        </button>
                    `)).join('') : '<p class="text-gray-400 text-center py-10">No se encontraron resultados. Intenta con otra búsqueda.</p>'}
                </div>
            </div>
        `;
        renderFolders(); // Actualiza el estilo de selección
    }

    function renderFolderContent(folderId) {
        const folder = folders.find(f => f.id === folderId);
        const songs = songsByFolder[folderId] || [];
        selectedFolderId = folderId;

        contentArea.innerHTML = `
            <div class="p-4 bg-gray-800/50 rounded-lg">
                <h2 class="text-3xl font-bold mb-2">${folder.name}</h2>
                ${folder.bpmRange ? `<p class="text-lg text-gray-400 mb-4">${folder.bpmRange}</p>`: ''}
                <div class="space-y-3">
                    ${songs.length > 0 ? songs.map(song => createSongCard(song, `
                        <button data-song='${JSON.stringify(song)}' data-folder-id="${folderId}" class="edit-song-btn p-2 text-gray-400 hover:text-blue-500 rounded-full bg-gray-700 hover:bg-gray-600 transition" title="Editar metadatos">
                            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd"></path></svg>
                        </button>
                        <button data-folder-id="${folderId}" data-song-id="${song.id}" class="remove-song-btn p-2 text-gray-400 hover:text-red-500 rounded-full bg-gray-700 hover:bg-gray-600 transition" title="Quitar de la carpeta">
                            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
                        </button>
                    `)).join('') : '<p class="text-gray-400 text-center py-10">Esta carpeta está vacía. ¡Añade canciones desde los resultados de búsqueda!</p>'}
                </div>
            </div>
        `;
        renderFolders(); // Actualiza el estilo de selección
    }
    
    function renderInitialMessage() {
        contentArea.innerHTML = `
            <div class="text-center p-8 rounded-lg bg-cover bg-center h-full flex flex-col justify-center" style="background-image: linear-gradient(rgba(10, 10, 10, 0.7), rgba(10, 10, 10, 0.9)), url('https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1000');">
                <h2 class="text-4xl font-bold text-white mb-3">Bienvenido a BPM Tracker</h2>
                <p class="text-lg text-gray-300 max-w-xl mx-auto">
                    Usa la barra de búsqueda para encontrar tus canciones favoritas y organizarlas por tempo y tonalidad.
                </p>
            </div>
        `;
        selectedFolderId = null;
        renderFolders();
    }

    // --- MANEJADORES DE ESTADO (localStorage) ---
    function saveData() {
        localStorage.setItem('bpm_tracker_folders', JSON.stringify(folders));
        localStorage.setItem('bpm_tracker_songs', JSON.stringify(songsByFolder));
    }

    function loadData() {
        const storedFolders = localStorage.getItem('bpm_tracker_folders');
        const storedSongs = localStorage.getItem('bpm_tracker_songs');

        if (storedFolders) {
            folders = JSON.parse(storedFolders);
        } else {
            folders = initialFolders;
        }

        if (storedSongs) {
            songsByFolder = JSON.parse(storedSongs);
        } else {
            songsByFolder = {};
            initialFolders.forEach(f => songsByFolder[f.id] = []);
        }
    }

    // --- MANEJADORES DE EVENTOS ---

    // Cambiar placeholder de la búsqueda según el tipo
    searchTypeSelect.addEventListener('change', () => {
        const selectedType = searchTypeSelect.value;
        const placeholders = {
            keyword: 'Busca por artista, canción...',
            track: 'Busca el título de una canción...',
            artist: 'Busca un artista...',
            album: 'Busca un álbum...',
            genre: 'Busca un género musical...',
            year: 'Busca un año (ej: 1995)...'
        };
        searchQueryInput.placeholder = placeholders[selectedType] || 'Buscar...';
    });

    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const queryValue = searchQueryInput.value.trim();
        if (!queryValue) return;

        const searchType = searchTypeSelect.value;
        let query;

        if (searchType === 'keyword') {
            query = queryValue;
        } else if (searchType === 'year') {
            query = `year:${queryValue.replace(/[^0-9]/g, '')}`; // Solo números para el año
        } else {
            query = `${searchType}:"${queryValue}"`;
        }
        
        const searchButtonText = searchButton.querySelector('span');
        searchButton.disabled = true;
        searchButtonText.textContent = 'Buscando...';
        contentArea.innerHTML = '<div class="text-center text-gray-400 p-8">Cargando resultados...</div>';
        
        try {
            const results = await searchTracks(query);
            renderSearchResults(results);
        } catch (error) {
            contentArea.innerHTML = `<div class="bg-red-500/20 border border-red-500 text-red-300 p-4 rounded-lg text-center">${error.message}</div>`;
        } finally {
            searchButton.disabled = false;
            searchButtonText.textContent = 'Buscar';
        }
    });
    
    createFolderForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = newFolderNameInput.value.trim();
        if (name) {
            const newFolder = { id: `custom-${Date.now()}`, name };
            folders.push(newFolder);
            songsByFolder[newFolder.id] = [];
            saveData();
            renderFolders();
            newFolderNameInput.value = '';
        }
    });

    folderListEl.addEventListener('click', (e) => {
        const folderCard = e.target.closest('.folder-card');
        const deleteBtn = e.target.closest('.folder-delete-btn');

        if (deleteBtn) { // Prioritize delete button click
            const folderId = deleteBtn.dataset.deleteId;
            const folderName = deleteBtn.dataset.deleteName;
            if (confirm(`¿Estás seguro de que quieres borrar la carpeta "${folderName}"? Esta acción no se puede deshacer.`)) {
                folders = folders.filter(f => f.id !== folderId);
                delete songsByFolder[folderId];
                if(selectedFolderId === folderId) {
                    selectedFolderId = null;
                    renderInitialMessage();
                }
                saveData();
                renderFolders();
            }
        } else if (folderCard) {
            const folderId = folderCard.dataset.folderId;
            searchQueryInput.value = '';
            renderFolderContent(folderId);
        }
    });
    
    contentArea.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.add-song-btn');
        if (addBtn) {
            songToAdd = JSON.parse(addBtn.dataset.song);
            openAddModal();
        }

        const removeBtn = e.target.closest('.remove-song-btn');
        if (removeBtn) {
            const { folderId, songId } = removeBtn.dataset;
            songsByFolder[folderId] = songsByFolder[folderId].filter(s => s.id !== songId);
            saveData();
            renderFolderContent(folderId);
        }
        
        const editBtn = e.target.closest('.edit-song-btn');
        if (editBtn) {
            const song = JSON.parse(editBtn.dataset.song);
            const folderId = editBtn.dataset.folderId;
            openEditModal(song, folderId);
        }
    });

    logoutButton.addEventListener('click', logout);
    
    // --- LÓGICA DE MODALES ---
    function openAddModal() {
        modalTitle.textContent = `Añadir "${songToAdd.title}" a...`;
        modalFolderList.innerHTML = folders.map(folder => {
            const songCount = songsByFolder[folder.id]?.length || 0;
            const isFull = songCount >= FOLDER_SONG_LIMIT;
            return `
                <li>
                    <button data-folder-id="${folder.id}" ${isFull ? 'disabled' : ''} class="modal-add-btn w-full text-left p-3 rounded-md transition-colors bg-gray-700 hover:bg-green-600 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed flex justify-between items-center">
                        <span>${folder.name} ${folder.bpmRange ? `(${folder.bpmRange})` : ''}</span>
                        <span class="text-xs text-gray-400">${songCount} / ${FOLDER_SONG_LIMIT}</span>
                    </button>
                </li>
            `;
        }).join('');
        modal.classList.remove('hidden');
    }

    function closeAddModal() {
        modal.classList.add('hidden');
        songToAdd = null;
    }

    modalCloseButton.addEventListener('click', closeAddModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAddModal();
    });

    modalFolderList.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.modal-add-btn');
        if (addBtn) {
            const folderId = addBtn.dataset.folderId;
            if (!songsByFolder[folderId]) {
                songsByFolder[folderId] = [];
            }
            if (songsByFolder[folderId].some(s => s.id === songToAdd.id)) {
                alert("Esta canción ya está en la carpeta.");
                return;
            }
            songsByFolder[folderId].push(songToAdd);
            saveData();
            renderFolders();
            if(selectedFolderId === folderId) {
                renderFolderContent(folderId);
            }
            closeAddModal();
        }
    });

    function openEditModal(song, folderId) {
        editSongIdInput.value = song.id;
        editFolderIdInput.value = folderId;
        editSongTitleInput.value = song.title;
        editSongArtistInput.value = song.artist;
        editSongAlbumInput.value = song.album;
        editSongKeyInput.value = song.key || '';
        editModal.classList.remove('hidden');
    }
    
    function closeEditModal() {
        editModal.classList.add('hidden');
        editForm.reset();
    }

    editCancelButton.addEventListener('click', closeEditModal);
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeEditModal();
    });
    
    editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const songId = editSongIdInput.value;
        const folderId = editFolderIdInput.value;
        const newTitle = editSongTitleInput.value;
        const newArtist = editSongArtistInput.value;
        const newAlbum = editSongAlbumInput.value;
        const newKey = editSongKeyInput.value;

        const songIndex = songsByFolder[folderId].findIndex(s => s.id === songId);
        if (songIndex !== -1) {
            songsByFolder[folderId][songIndex].title = newTitle;
            songsByFolder[folderId][songIndex].artist = newArtist;
            songsByFolder[folderId][songIndex].album = newAlbum;
            songsByFolder[folderId][songIndex].key = newKey;
        }

        saveData();
        renderFolderContent(folderId);
        closeEditModal();
    });

    // --- INICIALIZACIÓN ---
    function logout() {
        localStorage.removeItem('spotify_access_token');
        localStorage.removeItem('spotify_token_expires_at');
        localStorage.removeItem('bpm_tracker_folders');
        localStorage.removeItem('bpm_tracker_songs');
        window.location.href = 'index.html';
    }

    function init() {
        accessToken = localStorage.getItem('spotify_access_token');
        const expiresAt = localStorage.getItem('spotify_token_expires_at');
        
        if (!accessToken || !expiresAt || new Date().getTime() > parseInt(expiresAt)) {
            logout();
            return;
        }

        loadData();
        renderFolders();
        renderInitialMessage();

        // Disparar el evento change para establecer el placeholder inicial
        searchTypeSelect.dispatchEvent(new Event('change'));
    }

    init();
});