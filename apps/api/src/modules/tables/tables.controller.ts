import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { ListTablesQueryDto } from './dto/list-tables-query.dto';

@ApiTags('tables')
@ApiBearerAuth()
@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @RequirePermissions('tables.read')
  @ApiOperation({ summary: 'Lista as mesas de uma unidade, com status derivado (AVAILABLE/OCCUPIED)' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListTablesQueryDto) {
    return this.tablesService.findAllForBranch(user, query.branchId);
  }

  @Get(':id')
  @RequirePermissions('tables.read')
  @ApiOperation({ summary: 'Busca uma mesa — 404 se pertencer a outro tenant' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.tablesService.findOneForTenant(user, id);
  }

  @Post()
  @RequirePermissions('tables.create')
  @ApiOperation({ summary: 'Cria uma mesa (número único dentro da unidade)' })
  create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateTableDto) {
    return this.tablesService.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('tables.update')
  @ApiOperation({ summary: 'Edita número/nome/ativação de uma mesa' })
  update(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tablesService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('tables.delete')
  @ApiOperation({ summary: 'Exclui uma mesa (bloqueado enquanto houver comanda aberta)' })
  remove(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.tablesService.remove(user, id);
  }
}
