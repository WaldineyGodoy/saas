import { useState, useEffect, useMemo, useRef } from 'react';
import Map, { Marker, Popup, NavigationControl, FullscreenControl, ScaleControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import Papa from 'papaparse';
import { supabase } from '../../lib/supabase'; // Ajuste o caminho se necessário

// Coloque sua chave pública do Mapbox no arquivo .env.local como VITE_MAPBOX_TOKEN
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''; 

export default function GridMap() {
    const [substations, setSubstations] = useState([]);
    const [selectedSubstation, setSelectedSubstation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [cursorMode, setCursorMode] = useState('crosshair'); // 'crosshair' para busca, 'grab' para mover
    const fileInputRef = useRef(null);

    // Estado da view do mapa inicial (focado no Ceará, por exemplo)
    const [viewState, setViewState] = useState({
        longitude: -38.5267,
        latitude: -3.7319,
        zoom: 7,
        bearing: 0,
        pitch: 0
    });

    useEffect(() => {
        fetchSubstations();
    }, []);

    const fetchSubstations = async (lat = null, lng = null) => {
        setLoading(true);
        try {
            // Se tiver coordenadas, busca num raio de 20km via RPC
            if (lat && lng) {
                const { data, error } = await supabase.rpc('get_nearest_substations', {
                    p_latitude: lat,
                    p_longitude: lng,
                    p_limit: 150, // Limite de pontos na tela para performance
                    p_max_distance_meters: 20000 // 20km
                });
                if (error) throw error;
                setSubstations(data || []);
            } else {
                // Busca inicial padrão
                const { data, error } = await supabase
                    .from('distribuicao_subestacoes')
                    .select('*')
                    .limit(50);
                if (error) throw error;
                setSubstations(data || []);
            }
        } catch (err) {
            console.error('Erro ao buscar subestações:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleMapClick = async (event) => {
        // Se estiver no modo mão, não busca ao clicar
        if (cursorMode === 'grab') return;

        const { lngLat } = event;
        fetchSubstations(lngLat.lat, lngLat.lng);
    };

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setUploading(true);
        setError(null);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                try {
                    const recordsToInsert = results.data.map(row => {
                        // Tenta extrair colunas com nomes genéricos (qgis, excel, aneel padrao)
                        const lat = parseFloat(row.Y || row.latitude || row.LAT || row.NumLatitude || row.LATITUDE);
                        const lng = parseFloat(row.X || row.longitude || row.LONG || row.NumLongitude || row.LONGITUDE);
                        
                        // Busca o Nome/Código (prioriza COD_ID ou NOM que são o padrão ANEEL)
                        const nome = row.nome || row.NOM || row.COD_ID || row.NomSubestacao || row.NOME || row.Nome || 'Transformador';
                        
                        const codigo = row.codigo_aneel || row.COD_ID || row.CodSubestacao || `IMP-${Date.now()}-${Math.random()}`;
                        const distribuidora = row.distribuidora || row.DISTRIBUID || row.SigDistribuidora || row.DISTRIBUIDORA || '';
                        
                        // Tensão e Potência (padrão ANEEL: TEN_NOM e POT_NOM)
                        const tensao = parseFloat(row.tensao_kv || row.TEN_NOM || row.NumTensaoKv) || null;
                        const capacidade = parseFloat(row.capacidade_mva || row.POT_NOM || row.NumCapacidadeMva) || null;

                        if (isNaN(lat) || isNaN(lng)) return null;

                        return {
                            codigo_aneel: String(codigo),
                            nome: String(nome),
                            distribuidora: String(distribuidora),
                            tensao_kv: tensao,
                            capacidade_mva: capacidade,
                            latitude: lat,
                            longitude: lng,
                            localizacao: `SRID=4326;POINT(${lng} ${lat})`
                        };
                    }).filter(Boolean); // Remove os nulos

                    if (recordsToInsert.length === 0) {
                        throw new Error("Nenhum dado válido foi encontrado. O CSV precisa ter colunas claras de Latitude e Longitude (ex: 'latitude', 'LAT', etc).");
                    }

                    // Inserindo no Supabase em lotes (batching) para evitar limites de payload
                    const CHUNK_SIZE = 1000;
                    let insertedCount = 0;

                    for (let i = 0; i < recordsToInsert.length; i += CHUNK_SIZE) {
                        const chunk = recordsToInsert.slice(i, i + CHUNK_SIZE);
                        const { error: dbError } = await supabase
                            .from('distribuicao_subestacoes')
                            .insert(chunk);

                        if (dbError) throw dbError;
                        insertedCount += chunk.length;
                    }

                    alert(`Sucesso! ${insertedCount} registros foram importados para a base real.`);
                    fetchSubstations(); // Recarrega o mapa
                } catch (err) {
                    setError(`Erro ao importar CSV: ${err.message}`);
                } finally {
                    setUploading(false);
                    if(fileInputRef.current) fileInputRef.current.value = '';
                }
            },
            error: (err) => {
                setError(`Falha ao ler o arquivo: ${err.message}`);
                setUploading(false);
                if(fileInputRef.current) fileInputRef.current.value = '';
            }
        });
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery) return;
        try {
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}&country=br&limit=5`);
            const data = await res.json();
            setSearchResults(data.features || []);
        } catch(err) {
            console.error('Erro na busca:', err);
        }
    };

    const handleSelectResult = (feature) => {
        const [lng, lat] = feature.center;
        setViewState({
            ...viewState,
            longitude: lng,
            latitude: lat,
            zoom: 12
        });
        setSearchResults([]);
        setSearchQuery(feature.place_name);
        // Busca subestações automaticamente ao selecionar local da pesquisa
        fetchSubstations(lat, lng);
    };

    if (!MAPBOX_TOKEN) {
        return (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
                <h2>Mapbox Token não configurado!</h2>
                <p>Por favor, adicione <code>VITE_MAPBOX_TOKEN</code> ao seu arquivo <code>.env</code>.</p>
            </div>
        );
    }

    return (
        <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: 0 }}>Rede de Distribuição</h1>
                    <p style={{ color: '#666', margin: 0 }}>Clique no mapa para encontrar as 3 subestações mais próximas.</p>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Controle de Estilos Movido para o Mapa */}

                    {/* Botão de Upload CSV */}
                    <div>
                        <input 
                            type="file" 
                            accept=".csv" 
                            style={{ display: 'none' }} 
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                        />
                        <button 
                            className="btn btn-outline-primary d-flex align-items-center gap-2"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                        >
                            {uploading ? (
                                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                            ) : (
                                <i className="bi bi-cloud-arrow-up"></i>
                            )}
                            Importar BDGD (CSV)
                        </button>
                    </div>

                    {(loading && !uploading) && <span className="spinner-border text-primary" role="status" aria-hidden="true"></span>}
                </div>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            <div style={{ flex: 1, borderRadius: '12px', overflow: 'hidden', minHeight: '600px', position: 'relative', border: '1px solid #ddd' }}>
                <Map
                    {...viewState}
                    onMove={evt => setViewState(evt.viewState)}
                    onClick={handleMapClick}
                    mapStyle={mapStyle}
                    mapboxAccessToken={MAPBOX_TOKEN}
                    cursor={cursorMode}
                >
                    <FullscreenControl position="top-right" />
                    <NavigationControl position="top-right" />
                    <ScaleControl />

                    {/* Ferramenta de Alternância: Mão vs Seleção (Top Right abaixo do Nav) */}
                    <div style={{ position: 'absolute', top: '120px', right: '10px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <button 
                            className={`btn btn-sm ${cursorMode === 'crosshair' ? 'btn-primary' : 'btn-light'}`}
                            title="Modo Seleção (Clique para buscar)"
                            onClick={() => setCursorMode('crosshair')}
                            style={{ width: '30px', height: '30px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                        >
                            <i className="bi bi-cursor-fill"></i>
                        </button>
                        <button 
                            className={`btn btn-sm ${cursorMode === 'grab' ? 'btn-primary' : 'btn-light'}`}
                            title="Modo Mão (Arrastar mapa)"
                            onClick={() => setCursorMode('grab')}
                            style={{ width: '30px', height: '30px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                        >
                            <i className="bi bi-hand-index-thumb"></i>
                        </button>
                    </div>

                    {/* Floating Search Bar (Top Left) */}
                    <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, width: '350px', maxWidth: '90%' }}>
                        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '5px' }}>
                            <input 
                                type="text" 
                                className="form-control" 
                                placeholder="Pesquisar cidade, rua, coordenadas..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                            />
                            <button type="submit" className="btn btn-primary" style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                <i className="bi bi-search"></i>
                            </button>
                        </form>
                        {searchResults.length > 0 && (
                            <ul className="list-group mt-1" style={{ boxShadow: '0 4px 6px rgba(0,0,0,0.3)', maxHeight: '200px', overflowY: 'auto' }}>
                                {searchResults.map(res => (
                                    <li 
                                        key={res.id} 
                                        className="list-group-item list-group-item-action" 
                                        style={{ cursor: 'pointer', fontSize: '0.9rem' }} 
                                        onClick={() => handleSelectResult(res)}
                                    >
                                        {res.place_name}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Floating Map Style Selector (Bottom Left) */}
                    <div style={{ position: 'absolute', bottom: '30px', left: '10px', zIndex: 10 }}>
                        <select 
                            className="form-select form-select-sm" 
                            style={{ width: 'auto', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', fontWeight: 'bold' }}
                            value={mapStyle}
                            onChange={(e) => setMapStyle(e.target.value)}
                        >
                            <option value="mapbox://styles/mapbox/dark-v11">🌙 Escuro (Dark)</option>
                            <option value="mapbox://styles/mapbox/light-v11">☀️ Claro (Light)</option>
                            <option value="mapbox://styles/mapbox/streets-v12">🚗 Ruas</option>
                            <option value="mapbox://styles/mapbox/satellite-streets-v12">🌍 Satélite</option>
                        </select>
                    </div>

                    {substations.map(sub => (
                        <Marker
                            key={sub.id}
                            longitude={Number(sub.longitude)}
                            latitude={Number(sub.latitude)}
                            anchor="bottom"
                            onClick={e => {
                                e.originalEvent.stopPropagation();
                                setSelectedSubstation(sub);
                            }}
                        >
                            <div style={{ cursor: 'pointer', transform: 'translate(0, -10px)' }}>
                                <i className="bi bi-geo-alt-fill" style={{ fontSize: '2rem', color: '#ff4d4f', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}></i>
                            </div>
                        </Marker>
                    ))}

                    {selectedSubstation && (
                        <Popup
                            longitude={Number(selectedSubstation.longitude)}
                            latitude={Number(selectedSubstation.latitude)}
                            anchor="top"
                            onClose={() => setSelectedSubstation(null)}
                            closeOnClick={false}
                            style={{ padding: '10px' }}
                        >
                            <div style={{ color: '#333' }}>
                                <h6 style={{ fontWeight: 'bold', margin: '0 0 5px 0' }}>{selectedSubstation.nome}</h6>
                                <div style={{ fontSize: '0.85rem' }}>
                                    <p style={{ margin: '2px 0' }}><strong>Distribuidora:</strong> {selectedSubstation.distribuidora}</p>
                                    <p style={{ margin: '2px 0' }}><strong>Tensão:</strong> {selectedSubstation.tensao_kv} kV</p>
                                    <p style={{ margin: '2px 0' }}><strong>Capacidade:</strong> {selectedSubstation.capacidade_mva} MVA</p>
                                    {selectedSubstation.distancia_metros && (
                                        <p style={{ margin: '2px 0', color: '#ff4d4f' }}>
                                            <strong>Distância:</strong> {(selectedSubstation.distancia_metros / 1000).toFixed(1)} km
                                        </p>
                                    )}
                                </div>
                            </div>
                        </Popup>
                    )}
                </Map>
            </div>
        </div>
    );
}
