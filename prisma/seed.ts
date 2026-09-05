import { PrismaClient, PlatformRole, DepartmentRole, Priority } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const departments = [
  {
    code: 'HR',
    name: 'Human Resources',
    description: 'Employment verification, payroll, benefits, onboarding, workplace policies',
    requestTypes: [
      { code: 'EMP_VERIFICATION', name: 'Employment Verification Letter', description: 'Request official employment verification', defaultPriority: Priority.STANDARD },
      { code: 'PAYROLL', name: 'Payroll & Payslip Questions', description: 'Questions about salary, payslips, or tax deductions', defaultPriority: Priority.STANDARD },
      { code: 'BENEFITS', name: 'Benefits & Insurance', description: 'Health insurance, retirement plans, and employee benefits', defaultPriority: Priority.STANDARD },
      { code: 'ONBOARDING', name: 'Onboarding & Offboarding', description: 'New hire setup or exit procedures', defaultPriority: Priority.URGENT },
      { code: 'WORKPLACE_POLICY', name: 'Workplace Policy Questions', description: 'Questions about company policies and procedures', defaultPriority: Priority.LOW },
    ],
  },
  {
    code: 'IT',
    name: 'IT & Technical Support',
    description: 'Hardware, software, accounts, email, VPN, equipment',
    requestTypes: [
      { code: 'LAPTOP', name: 'Laptop/Desktop Problem', description: 'Hardware issues with laptop or desktop', defaultPriority: Priority.URGENT },
      { code: 'SOFTWARE', name: 'Software Installation/Update', description: 'Install or update software applications', defaultPriority: Priority.STANDARD },
      { code: 'ACCOUNT', name: 'Account or Password Access', description: 'Reset password or regain account access', defaultPriority: Priority.URGENT },
      { code: 'EMAIL', name: 'Email or Calendar Problem', description: 'Issues with email or calendar applications', defaultPriority: Priority.STANDARD },
      { code: 'VPN', name: 'VPN or Network Access', description: 'VPN setup or network connectivity issues', defaultPriority: Priority.URGENT },
      { code: 'EQUIPMENT', name: 'Equipment Request/Replacement', description: 'Request new or replacement hardware', defaultPriority: Priority.STANDARD },
    ],
  },
  {
    code: 'FAC',
    name: 'Facilities & Workplace',
    description: 'Repairs, desks, meeting rooms, badges, supplies',
    requestTypes: [
      { code: 'REPAIR', name: 'Office Repair/Maintenance', description: 'Report maintenance issues in the office', defaultPriority: Priority.URGENT },
      { code: 'DESK', name: 'Desk or Meeting Room Problem', description: 'Issues with desk or meeting room setup', defaultPriority: Priority.STANDARD },
      { code: 'BADGE', name: 'Access Badge/Building Access', description: 'Badge replacement or building access issues', defaultPriority: Priority.URGENT },
      { code: 'SUPPLIES', name: 'Office Supplies', description: 'Request office supplies', defaultPriority: Priority.LOW },
      { code: 'WORKSPACE', name: 'Workspace Move/Setup', description: 'Request workspace relocation or setup', defaultPriority: Priority.STANDARD },
    ],
  },
  {
    code: 'FIN',
    name: 'Finance',
    description: 'Expenses, invoices, payments, budget',
    requestTypes: [
      { code: 'EXPENSE', name: 'Expense Reimbursement', description: 'Submit expense report for reimbursement', defaultPriority: Priority.STANDARD },
      { code: 'INVOICE', name: 'Invoice or Vendor Question', description: 'Questions about invoices or vendor payments', defaultPriority: Priority.STANDARD },
      { code: 'PAYMENT', name: 'Payment/Banking Question', description: 'Questions about payment processing', defaultPriority: Priority.STANDARD },
      { code: 'BUDGET', name: 'Budget Clarification', description: 'Questions about budget allocations', defaultPriority: Priority.LOW },
    ],
  },
  {
    code: 'PEO',
    name: 'People Operations',
    description: 'Training, performance, wellbeing, workplace experience',
    requestTypes: [
      { code: 'TRAINING', name: 'Training Request', description: 'Request training or professional development', defaultPriority: Priority.STANDARD },
      { code: 'PERFORMANCE', name: 'Performance Support', description: 'Support for performance-related matters', defaultPriority: Priority.STANDARD },
      { code: 'WELLBEING', name: 'Employee Wellbeing', description: 'Wellbeing support and resources', defaultPriority: Priority.URGENT },
      { code: 'FEEDBACK', name: 'Workplace Experience Feedback', description: 'Feedback about workplace experience', defaultPriority: Priority.LOW },
    ],
  },
];

const demoUsers = [
  { ssoSubject: 'alex.chen', displayName: 'Yorgo Cnam', email: 'alex.chen@company.com', platformRole: PlatformRole.EMPLOYEE },
  { ssoSubject: 'sara.kumar', displayName: 'Francis the King', email: 'sara.kumar@company.com', platformRole: PlatformRole.EMPLOYEE },
  { ssoSubject: 'mike.howard', displayName: 'Mike Howard', email: 'mike.howard@company.com', platformRole: PlatformRole.EMPLOYEE },
  { ssoSubject: 'james.wilson', displayName: 'James Wilson', email: 'james.wilson@company.com', platformRole: PlatformRole.EMPLOYEE },
];

async function main() {
  console.log('Seeding database...');

  // Clean existing data
  await prisma.notificationEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.document.deleteMany();
  await prisma.request.deleteMany();
  await prisma.requestType.deleteMany();
  await prisma.departmentMember.deleteMany();
  await prisma.department.deleteMany();
  await prisma.user.deleteMany();

  // Create departments and request types
  for (const dept of departments) {
    const created = await prisma.department.create({
      data: {
        code: dept.code,
        name: dept.name,
        description: dept.description,
        requestTypes: {
          create: dept.requestTypes.map((rt) => ({
            code: rt.code,
            name: rt.name,
            description: rt.description,
            defaultPriority: rt.defaultPriority,
          })),
        },
      },
    });
    console.log(`  Department: ${created.code} (${created.name})`);
  }

  // Create users
  for (const u of demoUsers) {
    await prisma.user.create({ data: u });
  }
  console.log(`  Users: ${demoUsers.length} created`);

  // Create department memberships
  const allDepts = await prisma.department.findMany();
  const findDept = (code: string) => allDepts.find((d) => d.code === code)!;

  const memberships = [
    // Sara is IT agent
    { dept: 'IT', user: 'sara.kumar', role: DepartmentRole.AGENT },
    // Mike is HR agent
    { dept: 'HR', user: 'mike.howard', role: DepartmentRole.AGENT },
    // James is Facilities agent
    { dept: 'FAC', user: 'james.wilson', role: DepartmentRole.AGENT },
    // Alex is pure employee (no department membership)
  ];

  for (const m of memberships) {
    const dept = findDept(m.dept);
    const user = await prisma.user.findUnique({ where: { ssoSubject: m.user } });
    if (!user) { console.warn(`  User ${m.user} not found, skipping`); continue; }
    await prisma.departmentMember.create({
      data: {
        departmentId: dept.id,
        userId: user.id,
        departmentRole: m.role,
      },
    });
  }
  console.log(`  Memberships: ${memberships.length} created`);

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
