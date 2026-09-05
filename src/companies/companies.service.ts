import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PlatformRole, Priority } from '@prisma/client';

export const DEFAULT_DEPARTMENTS = [
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

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async registerCompany(dto: {
    name: string;
    slug: string;
    adminEmail: string;
    adminName: string;
  }) {
    const slug = dto.slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
    const adminEmail = dto.adminEmail.toLowerCase().trim();

    if (!slug) throw new BadRequestException('Invalid slug');
    if (!adminEmail) throw new BadRequestException('Invalid admin email');

    const existingSlug = await this.prisma.company.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new ConflictException(`Company with slug '${slug}' already exists`);
    }

    const existingUser = await this.prisma.user.findFirst({ where: { email: adminEmail } });
    if (existingUser) {
      throw new ConflictException(`User with email '${adminEmail}' is already registered with another company`);
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Create Company
      const company = await tx.company.create({
        data: {
          name: dto.name.trim(),
          slug,
        },
      });

      // 2. Create Default Departments and Request Types
      for (const dept of DEFAULT_DEPARTMENTS) {
        await tx.department.create({
          data: {
            companyId: company.id,
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
      }

      // 3. Create Company Admin User
      const admin = await tx.user.create({
        data: {
          companyId: company.id,
          ssoSubject: adminEmail,
          email: adminEmail,
          displayName: dto.adminName.trim() || adminEmail.split('@')[0],
          platformRole: PlatformRole.SYSTEM_ADMIN,
        },
      });

      return {
        success: true,
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
        },
        admin: {
          id: admin.id,
          email: admin.email,
          displayName: admin.displayName,
          platformRole: admin.platformRole,
        },
        message: `Company '${company.name}' successfully registered! Admin '${admin.email}' can now sign in.`,
      };
    });
  }

  async listCompanies() {
    return this.prisma.company.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async getCompanyBySlug(slug: string) {
    return this.prisma.company.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, active: true },
    });
  }
}
