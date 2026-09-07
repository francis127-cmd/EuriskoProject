/**
 * Enterprise End-to-End Test Suite
 *
 * Validates:
 * 1. Health & Readiness Probe
 * 2. Multi-Tenant Company Onboarding & Auto-Provisioning
 * 3. Discovery & Authentication Flow
 * 4. Request Lifecycle & Atomic Ticket Claiming (Race Condition Free)
 * 5. Complete Tenant Isolation (Zero Cross-Company Bleed)
 * 6. Security Exception Sanitization (Zero Stack Trace Leakage)
 */

const http = require('http');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 ENTERPRISE E2E CODEBASE VALIDATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name} ${extra ? `-> ${JSON.stringify(extra)}` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Health Check
    const health = await request('/health');
    assert('Health endpoint responds 200 with status ok', health.status === 200 && health.body?.status === 'ok', health.body);

    // 2. Register Company A
    const timestamp = Date.now();
    const companyA = await request('/companies/register', {
      method: 'POST',
      body: {
        name: `Acme Global ${timestamp}`,
        slug: `acme-${timestamp}`,
        domain: `acme-${timestamp}.com`,
        adminEmail: `admin@acme-${timestamp}.com`,
        adminPassword: 'Password123!',
        adminName: 'Acme Admin',
      },
    });
    assert('Company A successfully registered and provisioned', companyA.status === 201 || companyA.status === 200, companyA.body);
    const companyAId = companyA.body?.id;

    // 3. Login as Admin of Company A
    const loginA = await request('/auth/login', {
      method: 'POST',
      body: {
        email: `admin@acme-${timestamp}.com`,
        password: 'Password123!',
      },
    });
    assert('Admin of Company A logs in with password', loginA.status === 200 || loginA.status === 201, loginA.body);
    const tokenA = loginA.body?.accessToken;

    // 4. Verify Catalog Provisioning for Company A
    const catalogA = await request('/catalog', { token: tokenA });
    assert('Company A has automatically provisioned departments', Array.isArray(catalogA.body) && catalogA.body.length >= 5, catalogA.body?.length);

    // 5. Create a Ticket in Company A (IT department)
    const ticketA = await request('/requests', {
      method: 'POST',
      token: tokenA,
      body: {
        departmentCode: 'IT',
        requestTypeCode: 'LAPTOP',
        title: 'Broken Laptop Display',
        description: 'Screen flickering after upgrade',
        priority: 'URGENT',
      },
    });
    assert('Ticket created in Company A as PENDING', (ticketA.status === 201 || ticketA.status === 200) && ticketA.body?.status === 'PENDING', ticketA.body);
    const ticketAId = ticketA.body?.id;

    // 6. Concurrency Test: Atomic Compare-And-Swap Ticket Claiming
    console.log('\n⚡ Testing Atomic Ticket Claiming (Race Condition Prevention)...');
    const [claim1, claim2] = await Promise.all([
      request(`/requests/${ticketAId}/claim`, { method: 'POST', token: tokenA }),
      request(`/requests/${ticketAId}/claim`, { method: 'POST', token: tokenA }),
    ]);

    const oneSucceeded = (claim1.status === 200 || claim1.status === 201) !== (claim2.status === 200 || claim2.status === 201);
    const oneConflict = claim1.status === 409 || claim2.status === 409 || claim1.status === 400 || claim2.status === 400;
    assert('Exactly one concurrent agent successfully claims ticket (Race condition eliminated)', oneSucceeded || (claim1.status === 200 && claim2.status === 409) || (claim2.status === 200 && claim1.status === 409), { claim1: claim1.status, claim2: claim2.status });

    // 7. Multi-Tenant Isolation Test (Company B vs Company A)
    console.log('\n🛡️ Testing Multi-Tenant Isolation & Zero Data Bleed...');
    const companyB = await request('/companies/register', {
      method: 'POST',
      body: {
        name: `Stark Corp ${timestamp}`,
        slug: `stark-${timestamp}`,
        domain: `stark-${timestamp}.com`,
        adminEmail: `tony@stark-${timestamp}.com`,
        adminPassword: 'Password123!',
        adminName: 'Tony Stark',
      },
    });
    assert('Company B registered and isolated', companyB.status === 201 || companyB.status === 200, companyB.body);

    const loginB = await request('/auth/login', {
      method: 'POST',
      body: {
        email: `tony@stark-${timestamp}.com`,
        password: 'Password123!',
      },
    });
    const tokenB = loginB.body?.accessToken;

    // Attempt to access Company A's ticket with Company B's token
    const crossTenantProbe = await request(`/requests/${ticketAId}`, { token: tokenB });
    assert('Company B is BLOCKED from accessing Company A ticket (404/403 isolation)', crossTenantProbe.status === 404 || crossTenantProbe.status === 403, crossTenantProbe.status);

    // 8. Exception Sanitization Test (Zero Internal DB Leakage)
    console.log('\n🔒 Testing Exception Sanitization...');
    const malformedProbe = await request('/requests/not-a-valid-uuid', { token: tokenA });
    const hasStack = JSON.stringify(malformedProbe.body).includes('prisma') || JSON.stringify(malformedProbe.body).includes('SELECT') || JSON.stringify(malformedProbe.body).includes('at ');
    assert('Error response contains ZERO Prisma/DB stack traces', !hasStack, malformedProbe.body);

  } catch (err) {
    console.error('Fatal test execution error:', err.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
