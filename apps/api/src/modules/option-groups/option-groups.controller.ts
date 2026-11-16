import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import {
  CreateOptionGroupDto,
  CreateOptionItemDto,
  ReorderOptionsDto,
  SetGroupProductsDto,
  UpdateOptionGroupDto,
  UpdateOptionItemDto,
} from './dto/option-groups.dto';
import { OptionGroupsService } from './option-groups.service';

// Permissions are the menu's own (no new key): reading needs products.read; creating a group
// products.create; changing a group, its options and which products offer it products.update;
// deleting a whole group products.delete (OWNER/ADMIN), like deleting a product.
@ApiTags('option-groups')
@ApiBearerAuth()
@Controller('option-groups')
export class OptionGroupsController {
  constructor(private readonly service: OptionGroupsService) {}

  @Get()
  @RequirePermissions('products.read')
  @ApiOperation({ summary: 'Lista os grupos de adicionais, com opções e produtos vinculados' })
  list(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.service.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('products.read')
  findOne(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('products.create')
  @ApiOperation({ summary: 'Cria um grupo de adicionais (mínimo > 0 = obrigatório)' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateOptionGroupDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOptionGroupDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products.delete')
  @ApiOperation({
    summary: 'Exclui o grupo, suas opções e vínculos (pedidos antigos mantêm a cópia)',
  })
  remove(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.remove(user.tenantId, id);
  }

  @Put(':id/products')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Define quais produtos oferecem este grupo' })
  setProducts(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetGroupProductsDto,
  ) {
    return this.service.setProducts(user.tenantId, id, dto.productIds);
  }

  @Post(':id/options')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Adiciona uma opção ao grupo' })
  addOption(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateOptionItemDto,
  ) {
    return this.service.addOption(user.tenantId, id, dto);
  }

  @Post(':id/options/reorder')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products.update')
  reorderOptions(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReorderOptionsDto,
  ) {
    return this.service.reorderOptions(user.tenantId, id, dto.optionIds);
  }

  @Patch(':id/options/:optionId')
  @RequirePermissions('products.update')
  updateOption(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
    @Body() dto: UpdateOptionItemDto,
  ) {
    return this.service.updateOption(user.tenantId, id, optionId, dto);
  }

  @Delete(':id/options/:optionId')
  @RequirePermissions('products.update')
  @ApiOperation({ summary: 'Remove uma opção (pedidos antigos mantêm nome e preço)' })
  removeOption(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
  ) {
    return this.service.removeOption(user.tenantId, id, optionId);
  }
}
