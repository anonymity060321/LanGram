import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateGroupRemarkDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupRemark!: string | null;
}
