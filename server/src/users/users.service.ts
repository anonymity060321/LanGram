import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicUser {
  id: string;
  email: string | null;
  displayName: string;
  accountType: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findPublicById(userId: string): Promise<PublicUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        accountType: true,
        status: true,
        createdAt: true,
      },
    });

    return user;
  }
}
