import os
import requests
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

# Carrega variáveis de ambiente (local .env ou configuradas na nuvem)
load_dotenv()

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
# IMPORTANTE: Use a SERVICE_ROLE_KEY para ignorar as políticas de RLS e conseguir inserir os dados
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("As variáveis VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas no .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Constantes e Endpoints da ANEEL (Portal de Dados Abertos - CKAN)
# IDs dos resources podem mudar, estes são exemplos para a BDGD e SIGA baseados na estrutura padrão
ANEEL_CKAN_URL = "https://dadosabertos.aneel.gov.br/api/3/action/datastore_search"

# IDs fictícios/padrões para o exemplo. Na prática, você obterá os IDs exatos no portal dadosabertos.aneel.gov.br
RESOURCE_ID_BDGD_SUBESTACOES = "d5225aee-876a-4b95-a24c-1e230cecfbf8" 
RESOURCE_ID_SIGA_USINAS = "22c1b269-8a39-444a-93f9-715bd0528ad6"

def fetch_aneel_data(resource_id: str, limit: int = 1000):
    """Busca dados da API CKAN da ANEEL."""
    print(f"Buscando dados do resource: {resource_id}...")
    params = {
        'resource_id': resource_id,
        'limit': limit
    }
    response = requests.get(ANEEL_CKAN_URL, params=params)
    response.raise_for_status()
    
    data = response.json()
    if data.get('success'):
        records = data['result']['records']
        print(f"[{len(records)}] registros recebidos.")
        return pd.DataFrame(records)
    else:
        raise Exception(f"Falha na API da ANEEL: {data}")


def process_substations(df: pd.DataFrame):
    """Limpa, formata e insere dados das subestações no Supabase."""
    print("Processando subestações...")
    
    # Exemplo de mapeamento de colunas (dependerá do CSV real da ANEEL)
    # Supondo que o dataframe tenha 'nom_subestacao', 'sig_distribuidora', 'num_tensao', 'num_lat', 'num_long'
    
    # Simulação de tratamento caso as colunas padrão não existam no teste
    col_map = {
        'NomSubestacao': 'nome',
        'SigDistribuidora': 'distribuidora',
        'NumTensaoKv': 'tensao_kv',
        'NumCapacidadeMva': 'capacidade_mva',
        'NumLatitude': 'latitude',
        'NumLongitude': 'longitude',
        'CodSubestacao': 'codigo_aneel',
        'SigUf': 'estado',
        'NomMunicipio': 'municipio'
    }
    
    # Renomear apenas as colunas que existem no dataframe retornado
    rename_dict = {k: v for k, v in col_map.items() if k in df.columns}
    if rename_dict:
        df.rename(columns=rename_dict, inplace=True)
    
    # Garantir que as colunas essenciais existem, mesmo se os dados reais variarem
    required_cols = ['nome', 'latitude', 'longitude', 'codigo_aneel']
    for col in required_cols:
        if col not in df.columns:
            print(f"Aviso: Coluna {col} não encontrada. Criando mock temporário para funcionamento.")
            if col == 'latitude': df[col] = -23.5505
            elif col == 'longitude': df[col] = -46.6333
            elif col == 'codigo_aneel': df[col] = df.index.astype(str)
            else: df[col] = 'Desconhecido'

    # Limpeza básica (remover nulos de lat/long)
    df = df.dropna(subset=['latitude', 'longitude'])
    
    # Converter para numérico
    df['latitude'] = pd.to_numeric(df['latitude'], errors='coerce')
    df['longitude'] = pd.to_numeric(df['longitude'], errors='coerce')
    df = df.dropna(subset=['latitude', 'longitude'])
    
    records_to_insert = []
    for _, row in df.iterrows():
        # Criação do ponto WKT (Well-Known Text) para o PostGIS
        # O PostGIS entende SRID=4326;POINT(longitude latitude)
        lng = float(row['longitude'])
        lat = float(row['latitude'])
        point_wkt = f"SRID=4326;POINT({lng} {lat})"
        
        record = {
            "codigo_aneel": str(row.get('codigo_aneel', 'N/A')),
            "nome": str(row.get('nome', 'N/A')),
            "distribuidora": str(row.get('distribuidora', 'N/A')),
            "estado": str(row.get('estado', 'N/A')),
            "municipio": str(row.get('municipio', 'N/A')),
            "tensao_kv": float(row.get('tensao_kv', 0)) if pd.notnull(row.get('tensao_kv')) else None,
            "capacidade_mva": float(row.get('capacidade_mva', 0)) if pd.notnull(row.get('capacidade_mva')) else None,
            "latitude": lat,
            "longitude": lng,
            "localizacao": point_wkt
        }
        records_to_insert.append(record)
    
    # Upsert no Supabase
    if records_to_insert:
        print(f"Inserindo {len(records_to_insert)} subestações no Supabase...")
        try:
            # Em produção, fazer inserção em lotes (batch)
            batch_size = 500
            for i in range(0, len(records_to_insert), batch_size):
                batch = records_to_insert[i:i + batch_size]
                # Nota: 'codigo_aneel' precisaria ser UNIQUE para on_conflict funcionar perfeitamente
                response = supabase.table('distribuicao_subestacoes').insert(batch).execute()
            print("Inserção concluída com sucesso!")
        except Exception as e:
            print(f"Erro ao inserir dados: {e}")
    else:
        print("Nenhum registro válido para inserir.")

def run_ingestion_pipeline():
    """Executa o pipeline completo de ingestão."""
    print("Iniciando Pipeline de Ingestão ANEEL...")
    try:
        # Tenta buscar os dados reais
        df_subestacoes = fetch_aneel_data(RESOURCE_ID_BDGD_SUBESTACOES, limit=50)
        process_substations(df_subestacoes)
    except Exception as e:
        print(f"Erro ao acessar API (Possivelmente o resource_id não existe): {e}")
        print("Criando dados sintéticos (Mock) para validar o PostGIS e o Frontend...")
        
        # Criação de dados mock para testar a aplicação imediatamente (já que os resource_ids são fictícios)
        mock_data = pd.DataFrame([
            {"codigo_aneel": "SE-001", "nome": "SE Bom Jesus", "distribuidora": "ENEL-CE", "tensao_kv": 69, "capacidade_mva": 30, "latitude": -3.7319, "longitude": -38.5267},
            {"codigo_aneel": "SE-002", "nome": "SE Maracanaú", "distribuidora": "ENEL-CE", "tensao_kv": 69, "capacidade_mva": 50, "latitude": -3.8767, "longitude": -38.6253},
            {"codigo_aneel": "SE-003", "nome": "SE Caucaia", "distribuidora": "ENEL-CE", "tensao_kv": 138, "capacidade_mva": 100, "latitude": -3.7333, "longitude": -38.6500},
            {"codigo_aneel": "SE-004", "nome": "SE Eusébio", "distribuidora": "ENEL-CE", "tensao_kv": 69, "capacidade_mva": 45, "latitude": -3.8906, "longitude": -38.4503},
        ])
        process_substations(mock_data)

if __name__ == "__main__":
    run_ingestion_pipeline()
