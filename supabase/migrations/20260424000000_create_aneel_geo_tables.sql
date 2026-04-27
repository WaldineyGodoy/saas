-- Habilita a extensão PostGIS para cálculos geoespaciais
create extension if not exists postgis schema extensions;

-- Tabela de Subestações da Rede de Distribuição (Baseada na BDGD/SIGET)
create table if not exists public.distribuicao_subestacoes (
    id uuid default gen_random_uuid() primary key,
    codigo_aneel text not null,
    nome text not null,
    distribuidora text,
    estado text,
    municipio text,
    tensao_kv numeric,
    capacidade_mva numeric,
    -- Coluna geoespacial para armazenar a localização exata da subestação
    localizacao extensions.geometry(Point, 4326),
    latitude numeric,
    longitude numeric,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    atualizado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Índices geoespaciais para buscas super rápidas
create index if not exists distribuicao_subestacoes_localizacao_idx
    on public.distribuicao_subestacoes
    using gist (localizacao);

-- Tabela de Usinas Geradoras (Baseada no SIGA - para verificação de congestionamento)
create table if not exists public.geracao_usinas (
    id uuid default gen_random_uuid() primary key,
    codigo_ceg text not null,
    nome text not null,
    tipo_fonte text,
    potencia_outorgada_kw numeric,
    fase text, -- Operação, Construção, etc.
    estado text,
    municipio text,
    localizacao extensions.geometry(Point, 4326),
    latitude numeric,
    longitude numeric,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    atualizado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists geracao_usinas_localizacao_idx
    on public.geracao_usinas
    using gist (localizacao);


-- Função RPC para buscar as subestações mais próximas de uma coordenada fornecida pelo Front-end
create or replace function public.get_nearest_substations(
    p_latitude double precision,
    p_longitude double precision,
    p_limit integer default 3,
    p_max_distance_meters double precision default 50000 -- Distância máxima padrão de 50km
)
returns table (
    id uuid,
    nome text,
    distribuidora text,
    tensao_kv numeric,
    capacidade_mva numeric,
    latitude numeric,
    longitude numeric,
    distancia_metros double precision
)
language plpgsql
security definer
as $$
begin
    return query
    select
        s.id,
        s.nome,
        s.distribuidora,
        s.tensao_kv,
        s.capacidade_mva,
        s.latitude,
        s.longitude,
        -- st_distance returns meters because we cast to geography
        st_distance(
            s.localizacao::geography,
            st_setsrid(st_makepoint(p_longitude, p_latitude), 4326)::geography
        ) as distancia_metros
    from
        public.distribuicao_subestacoes s
    where
        st_dwithin(
            s.localizacao::geography,
            st_setsrid(st_makepoint(p_longitude, p_latitude), 4326)::geography,
            p_max_distance_meters
        )
    order by
        s.localizacao <-> st_setsrid(st_makepoint(p_longitude, p_latitude), 4326)
    limit p_limit;
end;
$$;
