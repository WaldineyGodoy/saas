import { describe, expect, it } from 'vitest';
import { lerConfig } from '../../src/config.js';

const base = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste' };

describe('lerConfig', () => {
  it('aplica os padroes', () => {
    expect(lerConfig(base)).toEqual({
      porta: 9220, auth: 'basic', connectionTimeoutS: 120,
      supabaseUrl: 'http://127.0.0.1:54321', serviceRoleKey: 'chave-de-teste',
    });
  });
  it('le PORT, OCPP_AUTH e CONNECTION_TIMEOUT_S', () => {
    expect(lerConfig({ ...base, PORT: '9300', OCPP_AUTH: 'off', CONNECTION_TIMEOUT_S: '45' }))
      .toMatchObject({ porta: 9300, auth: 'off', connectionTimeoutS: 45 });
  });
  it('variaveis vazias contam como ausentes (padrao)', () => {
    expect(lerConfig({ ...base, PORT: '', OCPP_AUTH: '', CONNECTION_TIMEOUT_S: '' }))
      .toMatchObject({ porta: 9220, auth: 'basic', connectionTimeoutS: 120 });
  });
  it('exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY, citando so os nomes', () => {
    expect(() => lerConfig({})).toThrow(/SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/s);
    expect(() => lerConfig({ SUPABASE_URL: 'x' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
  it('rejeita valores invalidos', () => {
    expect(() => lerConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => lerConfig({ ...base, PORT: '70000' })).toThrow(/PORT/);
    expect(() => lerConfig({ ...base, OCPP_AUTH: 'talvez' })).toThrow(/OCPP_AUTH/);
    expect(() => lerConfig({ ...base, CONNECTION_TIMEOUT_S: '0' })).toThrow(/CONNECTION_TIMEOUT_S/);
  });
});
